import { BadRequestException } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { AdminBookingsController } from './admin-bookings.controller.js';

// ⚖️ What is this file checking?
// This is where an admin steps in on a disputed booking and decides what
// happens to the money: refund the client, partially refund, release the
// money to the worker anyway, or escalate for further review. Because
// real money moves here, we check each decision routes to the RIGHT
// action — a "release_to_worker" decision must never accidentally
// trigger a refund, and vice versa.

describe('AdminBookingsController', () => {
  function buildController() {
    const prisma = { booking: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn() } } as any;
    const paymentsService = { issueRefund: jest.fn() } as any;
    const eventEmitter = { emit: jest.fn() } as any;
    const adminLogger = { log: jest.fn() } as any;
    const payoutsQueue = { add: jest.fn() } as any;
    return {
      controller: new AdminBookingsController(prisma, paymentsService, eventEmitter, adminLogger, payoutsQueue),
      prisma,
      paymentsService,
      eventEmitter,
      adminLogger,
      payoutsQueue,
    };
  }

  const admin = { sub: 'admin-1' } as any;

  describe('cancelBooking', () => {
    it('refuses to cancel a booking that is already COMPLETED or CANCELLED', async () => {
      const { controller, prisma } = buildController();
      prisma.booking.findUnique.mockResolvedValue({ status: BookingStatus.COMPLETED });

      await expect(
        controller.cancelBooking('b1', { reason: 'x' }, admin),
      ).rejects.toThrow(BadRequestException);
    });

    it('cancels the booking and writes an audit log entry', async () => {
      const { controller, prisma, adminLogger } = buildController();
      prisma.booking.findUnique.mockResolvedValue({ status: BookingStatus.PENDING });
      prisma.booking.update.mockResolvedValue({ id: 'b1', status: BookingStatus.CANCELLED });

      await controller.cancelBooking('b1', { reason: 'policy breach' }, admin);

      expect(adminLogger.log).toHaveBeenCalledWith(
        'admin-1',
        'BOOKING_CANCELLED',
        'booking',
        'b1',
        'policy breach',
      );
    });
  });

  describe('resolveDispute', () => {
    const disputedBooking = {
      id: 'b1',
      status: BookingStatus.DISPUTED,
      clientId: 'client-1',
      workerId: 'worker-1',
      totalAmountKobo: 1_000_000n,
      workerAmountKobo: 900_000n,
      payment: { id: 'payment-1' },
    };

    it('refuses to resolve a booking that has no active dispute', async () => {
      const { controller, prisma } = buildController();
      prisma.booking.findUnique.mockResolvedValue({ ...disputedBooking, status: BookingStatus.CONFIRMED });

      await expect(
        controller.resolveDispute('b1', { decision: 'refund_client', outcome: 'x' } as any, admin),
      ).rejects.toThrow(BadRequestException);
    });

    it('issues a full refund for a "refund_client" decision, and never touches the payout queue', async () => {
      const { controller, prisma, paymentsService, payoutsQueue } = buildController();
      prisma.booking.findUnique.mockResolvedValue(disputedBooking);

      await controller.resolveDispute(
        'b1',
        { decision: 'refund_client', outcome: 'worker no-show' } as any,
        admin,
      );

      expect(paymentsService.issueRefund).toHaveBeenCalledWith('payment-1', 1_000_000n, 'worker no-show');
      expect(payoutsQueue.add).not.toHaveBeenCalled();
    });

    it('issues only the specified amount for a "partial_refund" decision', async () => {
      const { controller, prisma, paymentsService } = buildController();
      prisma.booking.findUnique.mockResolvedValue(disputedBooking);

      await controller.resolveDispute(
        'b1',
        { decision: 'partial_refund', outcome: 'partial fault', refundAmountKobo: '300000' } as any,
        admin,
      );

      expect(paymentsService.issueRefund).toHaveBeenCalledWith('payment-1', 300_000n, 'partial fault');
    });

    it('queues the payout to the worker for a "release_to_worker" decision, and never calls issueRefund', async () => {
      const { controller, prisma, paymentsService, payoutsQueue } = buildController();
      prisma.booking.findUnique.mockResolvedValue(disputedBooking);

      await controller.resolveDispute(
        'b1',
        { decision: 'release_to_worker', outcome: 'client complaint unfounded' } as any,
        admin,
      );

      expect(payoutsQueue.add).toHaveBeenCalledWith(
        'release-escrow',
        expect.objectContaining({ bookingId: 'b1', workerId: 'worker-1' }),
      );
      expect(paymentsService.issueRefund).not.toHaveBeenCalled();
    });

    it('keeps the booking DISPUTED (instead of COMPLETED) when the decision is "escalate"', async () => {
      // Why: escalating means the case isn't actually resolved yet.
      const { controller, prisma } = buildController();
      prisma.booking.findUnique.mockResolvedValue(disputedBooking);

      await controller.resolveDispute(
        'b1',
        { decision: 'escalate', outcome: 'needs senior review' } as any,
        admin,
      );

      expect(prisma.booking.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { status: BookingStatus.DISPUTED },
      });
    });

    it('marks the booking COMPLETED once a refund/release decision is actually resolved', async () => {
      const { controller, prisma } = buildController();
      prisma.booking.findUnique.mockResolvedValue(disputedBooking);

      await controller.resolveDispute(
        'b1',
        { decision: 'release_to_worker', outcome: 'resolved' } as any,
        admin,
      );

      expect(prisma.booking.update).toHaveBeenCalledWith({
        where: { id: 'b1' },
        data: { status: BookingStatus.COMPLETED },
      });
    });
  });
});
