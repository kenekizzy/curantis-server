import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';

// 🔔 What is this file checking?
// This is the "bell icon" data — listing a user's own notifications, and
// letting them mark one as read. The one rule worth guarding: you can
// only mark YOUR OWN notifications as read, never someone else's.

describe('NotificationsService', () => {
  function buildService() {
    const prisma = {
      notification: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    } as any;
    return { service: new NotificationsService(prisma), prisma };
  }

  describe('markRead', () => {
    it('throws when the notification does not exist', async () => {
      const { service, prisma } = buildService();
      prisma.notification.findUnique.mockResolvedValue(null);

      await expect(service.markRead('user-1', 'ghost')).rejects.toThrow(NotFoundException);
    });

    it('refuses to mark someone else\'s notification as read', async () => {
      // Why: user A shouldn't be able to touch user B's notification bell.
      const { service, prisma } = buildService();
      prisma.notification.findUnique.mockResolvedValue({ id: 'n1', userId: 'someone-else' });

      await expect(service.markRead('user-1', 'n1')).rejects.toThrow(ForbiddenException);
    });

    it('marks the caller\'s own notification as read', async () => {
      const { service, prisma } = buildService();
      prisma.notification.findUnique.mockResolvedValue({ id: 'n1', userId: 'user-1' });
      prisma.notification.update.mockResolvedValue({ id: 'n1', isRead: true });

      await service.markRead('user-1', 'n1');

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { isRead: true },
      });
    });
  });
});
