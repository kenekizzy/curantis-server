import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AvailabilityService } from './availability.service.js';

// 📆 What is this file checking?
// This is a worker's calendar manager: their normal weekly hours, plus
// one-off "I'm away this week" blocks, plus a big pause switch. The
// important safety rule running through almost every method here is:
// "you can't change your schedule in a way that would strand a client
// who already has a confirmed booking with you."

describe('AvailabilityService', () => {
  function buildService() {
    const prisma = {
      workerProfile: { findUnique: jest.fn(), update: jest.fn() },
      availabilitySlot: { findMany: jest.fn(), deleteMany: jest.fn(), createMany: jest.fn() },
      availabilityBlock: {
        findMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      booking: { findMany: jest.fn(), findFirst: jest.fn() },
    } as any;
    return { service: new AvailabilityService(prisma), prisma };
  }

  describe('setWeeklySchedule', () => {
    it('refuses to change the schedule while there are upcoming confirmed bookings', async () => {
      // Why: changing your hours shouldn't be able to silently strand a
      // client who already booked and paid for a slot.
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue({ id: 'wp-1' });
      prisma.booking.findMany.mockResolvedValue([{ id: 'booking-1' }]);

      await expect(service.setWeeklySchedule('user-1', [])).rejects.toThrow(BadRequestException);
      expect(prisma.availabilitySlot.deleteMany).not.toHaveBeenCalled();
    });

    it('replaces the whole weekly schedule when there are no upcoming bookings in the way', async () => {
      // Why: this is a full replace — old slots go, new ones come in.
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue({ id: 'wp-1' });
      prisma.booking.findMany.mockResolvedValue([]);
      prisma.availabilitySlot.findMany.mockResolvedValue([{ dayOfWeek: 1 }]);

      await service.setWeeklySchedule('user-1', [
        { dayOfWeek: 1, startTime: '08:00', endTime: '18:00' } as any,
      ]);

      expect(prisma.availabilitySlot.deleteMany).toHaveBeenCalledWith({ where: { workerId: 'wp-1' } });
      expect(prisma.availabilitySlot.createMany).toHaveBeenCalled();
    });
  });

  describe('addBlock', () => {
    it('refuses a block where the end date is before the start date', async () => {
      // Why: an "away from 10th to 5th" block makes no sense.
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue({ id: 'wp-1' });

      await expect(
        service.addBlock('user-1', new Date('2026-01-10'), new Date('2026-01-05')),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a block that overlaps a confirmed booking', async () => {
      // Why: you can't mark yourself "unavailable" over a job you already committed to.
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue({ id: 'wp-1' });
      prisma.booking.findFirst.mockResolvedValue({ id: 'booking-1' });

      await expect(
        service.addBlock('user-1', new Date('2026-01-01'), new Date('2026-01-10')),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates the block when the dates are valid and nothing conflicts', async () => {
      // Why: the everyday case — "I'm going on leave next week."
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue({ id: 'wp-1' });
      prisma.booking.findFirst.mockResolvedValue(null);
      prisma.availabilityBlock.create.mockResolvedValue({ id: 'block-1' });

      const start = new Date('2026-01-01');
      const end = new Date('2026-01-10');
      await service.addBlock('user-1', start, end, 'Leave');

      expect(prisma.availabilityBlock.create).toHaveBeenCalledWith({
        data: { workerId: 'wp-1', startDate: start, endDate: end, reason: 'Leave' },
      });
    });
  });

  describe('deleteBlock', () => {
    it('refuses to delete a block that belongs to a different worker', async () => {
      // Why: workers must never be able to remove someone else's block.
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue({ id: 'wp-1' });
      prisma.availabilityBlock.findUnique.mockResolvedValue({ id: 'block-1', workerId: 'someone-else' });

      await expect(service.deleteBlock('user-1', 'block-1')).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFound when the caller has no worker profile', async () => {
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue(null);

      await expect(service.deleteBlock('user-1', 'block-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('togglePause', () => {
    it('flips the isAvailable switch for the caller', async () => {
      // Why: this is the big "pause my whole profile" toggle.
      const { service, prisma } = buildService();
      prisma.workerProfile.update.mockResolvedValue({ userId: 'user-1', isAvailable: false });

      await service.togglePause('user-1', false);

      expect(prisma.workerProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' }, data: { isAvailable: false } }),
      );
    });
  });
});
