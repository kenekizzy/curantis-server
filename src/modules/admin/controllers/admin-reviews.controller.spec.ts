import { AdminReviewsController } from './admin-reviews.controller.js';

// 🧹 What is this file checking?
// Admin review moderation: hiding an abusive/fake review, or bringing a
// wrongly-removed one back. Both actions leave an audit log entry, and
// "restore" must clear out any old removal reason so the review looks
// clean again.

describe('AdminReviewsController', () => {
  function buildController() {
    const prisma = { review: { findMany: jest.fn(), update: jest.fn() } } as any;
    const adminLogger = { log: jest.fn() } as any;
    return { controller: new AdminReviewsController(prisma, adminLogger), prisma, adminLogger };
  }

  const admin = { sub: 'admin-1' } as any;

  it('removes a review, records the reason, and logs the admin action', async () => {
    const { controller, prisma, adminLogger } = buildController();
    prisma.review.update.mockResolvedValue({ id: 'review-1', status: 'REMOVED' });

    await controller.remove('review-1', { reason: 'abusive language' }, admin);

    expect(prisma.review.update).toHaveBeenCalledWith({
      where: { id: 'review-1' },
      data: { status: 'REMOVED', removedReason: 'abusive language' },
    });
    expect(adminLogger.log).toHaveBeenCalledWith(
      'admin-1',
      'REVIEW_REMOVED',
      'review',
      'review-1',
      'abusive language',
    );
  });

  it('restoring a review clears the old removal reason', async () => {
    // Why: a restored review shouldn't still show a leftover "removed because..." note.
    const { controller, prisma } = buildController();
    prisma.review.update.mockResolvedValue({ id: 'review-1', status: 'PUBLISHED' });

    await controller.restore('review-1', admin);

    expect(prisma.review.update).toHaveBeenCalledWith({
      where: { id: 'review-1' },
      data: { status: 'PUBLISHED', removedReason: null },
    });
  });
});
