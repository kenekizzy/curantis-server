import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { BookingsService } from './bookings.service.js';

// 🗓️ What is this file checking?
// Bookings are the heart of the whole app — a client asking a caregiver
// "please come help on this date, for this many hours". This file checks
// every step of a booking's life:
//   create → accept/decline → start → complete   (the happy path)
//   ...with cancel and dispute as escape hatches along the way.
//
// The most important safety rules we check:
//   - you can't book an unverified or paused caregiver
//   - a Healthcare Student can't take a job that needs a licensed worker
//   - you can't double-book the same caregiver for an overlapping time
//   - money math (total, platform's 10% cut, worker's share) must be exact
//   - only the right person (the assigned worker, the client, or an admin)
//     can act on a given booking — nobody else

describe('BookingsService', () => {
  function buildService() {
    const prisma = {
      workerProfile: { findUnique: jest.fn() },
      serviceCategory: { findUnique: jest.fn() },
      booking: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      bookingLog: { create: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn((cb: any) => cb(prisma)),
    } as any;
    const eventEmitter = { emit: jest.fn() } as any;
    const bookingsQueue = { add: jest.fn(), getJob: jest.fn() } as any;
    return {
      service: new BookingsService(prisma, eventEmitter, bookingsQueue),
      prisma,
      eventEmitter,
      bookingsQueue,
    };
  }

  const verifiedWorker = {
    userId: 'worker-1',
    verificationStatus: 'VERIFIED',
    isAvailable: true,
    workerType: 'HW',
    hourlyRateKobo: 500000n, // ₦5,000/hr
  };
  const openCategory = { id: 'cat-1', isRestricted: false };
  const createDto = {
    workerId: 'worker-1',
    categoryId: 'cat-1',
    careAddress: '123 Street',
    scheduledStart: '2026-08-01T09:00:00.000Z',
    durationHours: 2,
  };

  describe('create', () => {
    it('refuses to book a caregiver who is not verified or has paused availability', async () => {
      // Why: safety first — an unverified worker should never receive a booking.
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue({
        ...verifiedWorker,
        verificationStatus: 'PENDING',
      });

      await expect(service.create('client-1', createDto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses when the chosen service category does not exist', async () => {
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue(verifiedWorker);
      prisma.serviceCategory.findUnique.mockResolvedValue(null);

      await expect(service.create('client-1', createDto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses a Healthcare Student for a restricted (licensed-only) category', async () => {
      // Why: e.g. Nursing Care needs a licensed HW — an HS student can't take it.
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue({ ...verifiedWorker, workerType: 'HS' });
      prisma.serviceCategory.findUnique.mockResolvedValue({ id: 'cat-1', isRestricted: true });

      await expect(service.create('client-1', createDto as any)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses to double-book a caregiver for an overlapping time slot', async () => {
      // Why: one caregiver, one job at a time — no overlapping bookings.
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue(verifiedWorker);
      prisma.serviceCategory.findUnique.mockResolvedValue(openCategory);
      prisma.booking.findFirst.mockResolvedValue({ id: 'existing-booking' });

      await expect(service.create('client-1', createDto as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('creates the booking with exact money math, logs it, schedules auto-decline, and announces it', async () => {
      // Why: this is the full happy path — every side effect must happen.
      const { service, prisma, eventEmitter, bookingsQueue } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue(verifiedWorker);
      prisma.serviceCategory.findUnique.mockResolvedValue(openCategory);
      prisma.booking.findFirst.mockResolvedValue(null);
      prisma.booking.create.mockResolvedValue({ id: 'booking-1' });

      await service.create('client-1', createDto as any);

      // ₦5,000/hr * 2 hours = ₦10,000 = 1,000,000 kobo. 10% platform fee = 100,000.
      const createArgs = prisma.booking.create.mock.calls[0][0].data;
      expect(createArgs.totalAmountKobo).toBe(1_000_000n);
      expect(createArgs.platformFeeKobo).toBe(100_000n);
      expect(createArgs.workerAmountKobo).toBe(900_000n);

      expect(prisma.bookingLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ eventType: 'CREATED' }) }),
      );
      expect(bookingsQueue.add).toHaveBeenCalledWith(
        'auto-decline',
        { bookingId: 'booking-1' },
        expect.objectContaining({ jobId: 'auto-decline-booking-1' }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'booking.created',
        expect.objectContaining({ bookingId: 'booking-1' }),
      );
    });
  });

  describe('accept', () => {
    it('refuses when someone other than the assigned worker tries to accept it', async () => {
      // Why: a random worker shouldn't be able to accept a job meant for someone else.
      const { service, prisma } = buildService();
      prisma.booking.findUnique.mockResolvedValue({ id: 'b1', workerId: 'someone-else' });

      await expect(service.accept('b1', 'worker-1')).rejects.toThrow(ForbiddenException);
    });

    it('refuses to accept a booking that is no longer PENDING', async () => {
      // Why: you can't "accept" something that's already been accepted or cancelled.
      const { service, prisma } = buildService();
      prisma.booking.findUnique.mockResolvedValue({
        id: 'b1',
        workerId: 'worker-1',
        status: BookingStatus.ACCEPTED,
      });

      await expect(service.accept('b1', 'worker-1')).rejects.toThrow(BadRequestException);
    });

    it('moves a PENDING booking to ACCEPTED and cancels the auto-decline timer', async () => {
      // Why: accepting is a race against the 2-hour auto-decline job — once
      // accepted, that timer must be cancelled so it doesn't fire later.
      const { service, prisma, bookingsQueue, eventEmitter } = buildService();
      prisma.booking.findUnique.mockResolvedValue({
        id: 'b1',
        workerId: 'worker-1',
        clientId: 'client-1',
        status: BookingStatus.PENDING,
      });
      bookingsQueue.getJob.mockResolvedValue({ remove: jest.fn() });

      const result = await service.accept('b1', 'worker-1');

      expect(result).toEqual({ status: BookingStatus.ACCEPTED });
      expect(bookingsQueue.getJob).toHaveBeenCalledWith('auto-decline-b1');
      expect(eventEmitter.emit).toHaveBeenCalledWith('booking.accepted', expect.any(Object));
    });
  });

  describe('cancel', () => {
    it('throws when the booking does not exist', async () => {
      const { service, prisma } = buildService();
      prisma.booking.findUnique.mockResolvedValue(null);

      await expect(service.cancel('ghost', 'user-1', 'CLIENT', 'changed my mind')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses when the actor is neither the client, the worker, nor an admin', async () => {
      // Why: a stranger shouldn't be able to cancel someone else's booking.
      const { service, prisma } = buildService();
      prisma.booking.findUnique.mockResolvedValue({
        id: 'b1',
        clientId: 'client-1',
        workerId: 'worker-1',
        status: BookingStatus.PENDING,
      });

      await expect(service.cancel('b1', 'stranger', 'CLIENT', 'x')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses to cancel a booking that is already COMPLETED or CANCELLED', async () => {
      // Why: cancelling something that already finished makes no sense.
      const { service, prisma } = buildService();
      prisma.booking.findUnique.mockResolvedValue({
        id: 'b1',
        clientId: 'client-1',
        workerId: 'worker-1',
        status: BookingStatus.COMPLETED,
      });

      await expect(service.cancel('b1', 'client-1', 'CLIENT', 'x')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('lets an admin cancel any booking regardless of who it belongs to', async () => {
      // Why: admins are the safety-net for policy/safeguarding cancellations.
      const { service, prisma, eventEmitter } = buildService();
      prisma.booking.findUnique.mockResolvedValue({
        id: 'b1',
        clientId: 'client-1',
        workerId: 'worker-1',
        status: BookingStatus.PENDING,
      });

      await service.cancel('b1', 'admin-1', 'ADMIN', 'policy breach');

      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ cancelledBy: 'ADMIN' }) }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith('booking.cancelled', expect.any(Object));
    });
  });

  describe('start / complete', () => {
    it('refuses to start a booking that is not yet CONFIRMED', async () => {
      // Why: a job can't start before payment confirms the booking.
      const { service, prisma } = buildService();
      prisma.booking.findUnique.mockResolvedValue({
        id: 'b1',
        workerId: 'worker-1',
        status: BookingStatus.PENDING,
      });

      await expect(service.start('b1', 'worker-1')).rejects.toThrow(BadRequestException);
    });

    it('refuses to complete a booking that is not IN_PROGRESS', async () => {
      const { service, prisma } = buildService();
      prisma.booking.findUnique.mockResolvedValue({
        id: 'b1',
        workerId: 'worker-1',
        status: BookingStatus.CONFIRMED,
      });

      await expect(service.complete('b1', 'worker-1')).rejects.toThrow(BadRequestException);
    });

    it('completing a booking sets a 24-hour escrow release time and announces the payout amount', async () => {
      // Why: money is only released to the worker 24 hours after completion,
      // giving the client a window to raise a dispute if something went wrong.
      const { service, prisma, eventEmitter } = buildService();
      const before = Date.now();
      prisma.booking.findUnique.mockResolvedValue({
        id: 'b1',
        workerId: 'worker-1',
        clientId: 'client-1',
        status: BookingStatus.IN_PROGRESS,
        workerAmountKobo: 900_000n,
      });

      await service.complete('b1', 'worker-1');

      const updateData = prisma.booking.update.mock.calls[0][0].data;
      expect(updateData.escrowReleaseAt.getTime()).toBeGreaterThanOrEqual(before + 24 * 3_600_000);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'booking.completed',
        expect.objectContaining({ workerAmountKobo: 900_000n }),
      );
    });
  });

  describe('raiseDispute', () => {
    it('refuses when the person raising the dispute is not part of this booking', async () => {
      const { service, prisma } = buildService();
      prisma.booking.findUnique.mockResolvedValue({
        id: 'b1',
        clientId: 'client-1',
        workerId: 'worker-1',
      });

      await expect(service.raiseDispute('b1', 'stranger', 'issue')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('marks the booking DISPUTED and tells PaymentsModule to hold the payout', async () => {
      // Why: PaymentsModule listens for this exact event to cancel any
      // scheduled escrow release — money must not go out mid-dispute.
      const { service, prisma, eventEmitter } = buildService();
      prisma.booking.findUnique.mockResolvedValue({
        id: 'b1',
        clientId: 'client-1',
        workerId: 'worker-1',
      });

      await service.raiseDispute('b1', 'client-1', 'worker did not show up');

      expect(prisma.booking.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: BookingStatus.DISPUTED } }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith('booking.disputed', expect.any(Object));
    });
  });

  describe('list', () => {
    it('only shows a CLIENT their own bookings', async () => {
      const { service, prisma } = buildService();
      prisma.booking.findMany.mockResolvedValue([]);

      await service.list('client-1', 'CLIENT', {} as any);

      expect(prisma.booking.findMany.mock.calls[0][0].where).toEqual({ clientId: 'client-1' });
    });

    it('only shows a worker (HW/HS) bookings assigned to them', async () => {
      const { service, prisma } = buildService();
      prisma.booking.findMany.mockResolvedValue([]);

      await service.list('worker-1', 'HW', {} as any);

      expect(prisma.booking.findMany.mock.calls[0][0].where).toEqual({ workerId: 'worker-1' });
    });

    it('shows an ADMIN every booking, with no owner filter at all', async () => {
      const { service, prisma } = buildService();
      prisma.booking.findMany.mockResolvedValue([]);

      await service.list('admin-1', 'ADMIN', {} as any);

      expect(prisma.booking.findMany.mock.calls[0][0].where).toEqual({});
    });
  });

  describe('findOne', () => {
    it('throws NotFound when the booking does not exist', async () => {
      const { service, prisma } = buildService();
      prisma.booking.findUnique.mockResolvedValue(null);

      await expect(service.findOne('ghost', 'user-1', 'CLIENT')).rejects.toThrow(NotFoundException);
    });

    it('refuses to show the booking to someone unrelated to it', async () => {
      const { service, prisma } = buildService();
      prisma.booking.findUnique.mockResolvedValue({ clientId: 'client-1', workerId: 'worker-1' });

      await expect(service.findOne('b1', 'stranger', 'CLIENT')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('lets an admin view any booking', async () => {
      const { service, prisma } = buildService();
      prisma.booking.findUnique.mockResolvedValue({ clientId: 'client-1', workerId: 'worker-1' });

      await expect(service.findOne('b1', 'admin-1', 'ADMIN')).resolves.toBeDefined();
    });
  });
});
