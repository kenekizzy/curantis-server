import { ReviewsCron } from './reviews.cron.js';

// 🔒 What is this file checking?
// This hourly job is what actually enforces the "48 hours to edit your
// review" rule from ReviewsService — it finds every review older than
// 48 hours that hasn't been locked yet, and locks it permanently.

describe('ReviewsCron', () => {
  it('locks every review older than 48 hours that has not been locked yet', async () => {
    const prisma = { review: { updateMany: jest.fn() } } as any;
    const cron = new ReviewsCron(prisma);

    await cron.lockExpiredReviews();

    expect(prisma.review.updateMany).toHaveBeenCalledWith({
      where: { createdAt: { lt: expect.any(Date) }, lockedAt: null },
      data: { lockedAt: expect.any(Date) },
    });
  });
});
