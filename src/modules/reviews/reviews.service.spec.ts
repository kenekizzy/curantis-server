import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReviewsService } from './reviews.service.js';

// ⭐ What is this file checking?
// After a booking finishes, the client can leave a star rating and a
// written review. The important rules:
//   - you can only review a booking that's actually COMPLETED
//   - you can't review the same booking twice
//   - you get a 48-hour window to edit your review, then it locks forever
//   - every time a review changes, the worker's overall average rating
//     must be recalculated so it's always accurate

describe('ReviewsService', () => {
  function buildService() {
    const prisma = {
      booking: { findUnique: jest.fn() },
      review: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), aggregate: jest.fn() },
      workerProfile: { update: jest.fn() },
    } as any;
    return { service: new ReviewsService(prisma), prisma };
  }

  describe('create', () => {
    it('refuses to review a booking that is not COMPLETED yet', async () => {
      // Why: you shouldn't be able to rate a caregiver before the job even happened.
      const { service, prisma } = buildService();
      prisma.booking.findUnique.mockResolvedValue({ clientId: 'client-1', status: 'CONFIRMED' });

      await expect(
        service.create('client-1', { bookingId: 'b1', rating: 5 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a second review on the same booking', async () => {
      // Why: one review per completed job — no piling on.
      const { service, prisma } = buildService();
      prisma.booking.findUnique.mockResolvedValue({ clientId: 'client-1', status: 'COMPLETED' });
      prisma.review.findUnique.mockResolvedValue({ id: 'existing-review' });

      await expect(
        service.create('client-1', { bookingId: 'b1', rating: 5 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates the review and recalculates the worker\'s average rating afterwards', async () => {
      // Why: the worker's public star rating must always reflect their latest reviews.
      const { service, prisma } = buildService();
      prisma.booking.findUnique.mockResolvedValue({
        clientId: 'client-1',
        workerId: 'worker-1',
        status: 'COMPLETED',
      });
      prisma.review.findUnique.mockResolvedValue(null);
      prisma.review.create.mockResolvedValue({ id: 'review-1' });
      prisma.review.aggregate.mockResolvedValue({ _avg: { rating: 4.5 }, _count: { rating: 2 } });

      await service.create('client-1', { bookingId: 'b1', rating: 5, body: 'Great!' } as any);

      expect(prisma.workerProfile.update).toHaveBeenCalledWith({
        where: { userId: 'worker-1' },
        data: { avgRating: 4.5, reviewCount: 2 },
      });
    });
  });

  describe('update', () => {
    it('refuses to edit a review that belongs to someone else', async () => {
      const { service, prisma } = buildService();
      prisma.review.findUnique.mockResolvedValue({ clientId: 'someone-else' });

      await expect(
        service.update('review-1', 'client-1', { rating: 4 } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses to edit a review after the 48-hour window has passed', async () => {
      // Why: reviews need to become permanent at some point to stay trustworthy.
      const { service, prisma } = buildService();
      prisma.review.findUnique.mockResolvedValue({
        clientId: 'client-1',
        createdAt: new Date(Date.now() - 49 * 3_600_000),
      });

      await expect(
        service.update('review-1', 'client-1', { rating: 4 } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows editing within the 48-hour window and recalculates the rating', async () => {
      const { service, prisma } = buildService();
      prisma.review.findUnique.mockResolvedValue({
        clientId: 'client-1',
        workerId: 'worker-1',
        createdAt: new Date(Date.now() - 1 * 3_600_000),
      });
      prisma.review.update.mockResolvedValue({ id: 'review-1' });
      prisma.review.aggregate.mockResolvedValue({ _avg: { rating: 3.5 }, _count: { rating: 3 } });

      await service.update('review-1', 'client-1', { rating: 3, body: 'Updated' } as any);

      expect(prisma.review.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ rating: 3 }) }),
      );
      expect(prisma.workerProfile.update).toHaveBeenCalled();
    });
  });

  describe('flag', () => {
    it('throws when the review does not exist', async () => {
      const { service, prisma } = buildService();
      prisma.review.findUnique.mockResolvedValue(null);

      await expect(service.flag('ghost')).rejects.toThrow(NotFoundException);
    });

    it('marks an existing review as FLAGGED', async () => {
      // Why: this is how a suspicious/abusive review gets sent for admin moderation.
      const { service, prisma } = buildService();
      prisma.review.findUnique.mockResolvedValue({ id: 'review-1' });
      prisma.review.update.mockResolvedValue({ id: 'review-1', status: 'FLAGGED' });

      await service.flag('review-1');

      expect(prisma.review.update).toHaveBeenCalledWith({
        where: { id: 'review-1' },
        data: { status: 'FLAGGED' },
      });
    });
  });
});
