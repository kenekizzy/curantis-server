import { ChatService } from './chat.service.js';

// 💬 What is this file checking?
// This is the bouncer + record-keeper for private chat between a client
// and their caregiver. The single most important rule is canAccess:
// "is this person actually allowed to be in this conversation right now?"
//   - Admins can always look in (support).
//   - A random third person can never join someone else's conversation.
//   - If the conversation is tied to a booking, chat only stays open
//     while that booking is CONFIRMED, IN_PROGRESS, or COMPLETED within
//     the last 7 days — otherwise it locks.

describe('ChatService', () => {
  function buildService() {
    const prisma = {
      conversation: { findUnique: jest.fn() },
      user: { findUnique: jest.fn() },
      booking: { findUnique: jest.fn() },
      message: { findMany: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    } as any;
    const storage = {
      getUploadSignature: jest.fn(),
      buildPublicId: jest.fn((scope: string, filename: string) => `${scope}/123-${filename}`),
    } as any;
    return { service: new ChatService(prisma, storage), prisma, storage };
  }

  describe('canAccess', () => {
    it('returns false when the conversation does not exist at all', async () => {
      const { service, prisma } = buildService();
      prisma.conversation.findUnique.mockResolvedValue(null);

      expect(await service.canAccess('user-1', 'conv-1')).toBe(false);
    });

    it('always lets an admin into any conversation, for support purposes', async () => {
      const { service, prisma } = buildService();
      prisma.conversation.findUnique.mockResolvedValue({ participantA: 'x', participantB: 'y' });
      prisma.user.findUnique.mockResolvedValue({ role: 'ADMIN' });

      expect(await service.canAccess('admin-1', 'conv-1')).toBe(true);
    });

    it('refuses someone who is not one of the two participants', async () => {
      const { service, prisma } = buildService();
      prisma.conversation.findUnique.mockResolvedValue({ participantA: 'user-a', participantB: 'user-b' });
      prisma.user.findUnique.mockResolvedValue({ role: 'CLIENT' });

      expect(await service.canAccess('stranger', 'conv-1')).toBe(false);
    });

    it('allows a participant into a conversation with no linked booking (e.g. a support chat)', async () => {
      const { service, prisma } = buildService();
      prisma.conversation.findUnique.mockResolvedValue({
        participantA: 'user-1',
        participantB: 'user-2',
        bookingId: null,
      });
      prisma.user.findUnique.mockResolvedValue({ role: 'CLIENT' });

      expect(await service.canAccess('user-1', 'conv-1')).toBe(true);
    });

    it('keeps chat open while the linked booking is CONFIRMED', async () => {
      const { service, prisma } = buildService();
      prisma.conversation.findUnique.mockResolvedValue({
        participantA: 'user-1',
        participantB: 'user-2',
        bookingId: 'booking-1',
      });
      prisma.user.findUnique.mockResolvedValue({ role: 'CLIENT' });
      prisma.booking.findUnique.mockResolvedValue({ status: 'CONFIRMED', actualEnd: null });

      expect(await service.canAccess('user-1', 'conv-1')).toBe(true);
    });

    it('keeps chat open for 7 days after a booking is COMPLETED, then locks it', async () => {
      // Why: clients and workers may still need to talk shortly after a job
      // finishes, but chat shouldn't stay open forever.
      const { service, prisma } = buildService();
      prisma.conversation.findUnique.mockResolvedValue({
        participantA: 'user-1',
        participantB: 'user-2',
        bookingId: 'booking-1',
      });
      prisma.user.findUnique.mockResolvedValue({ role: 'CLIENT' });

      prisma.booking.findUnique.mockResolvedValue({
        status: 'COMPLETED',
        actualEnd: new Date(Date.now() - 3 * 24 * 3_600_000), // 3 days ago
      });
      expect(await service.canAccess('user-1', 'conv-1')).toBe(true);

      prisma.booking.findUnique.mockResolvedValue({
        status: 'COMPLETED',
        actualEnd: new Date(Date.now() - 8 * 24 * 3_600_000), // 8 days ago
      });
      expect(await service.canAccess('user-1', 'conv-1')).toBe(false);
    });

    it('locks chat while the booking is still just PENDING (not yet paid/confirmed)', async () => {
      const { service, prisma } = buildService();
      prisma.conversation.findUnique.mockResolvedValue({
        participantA: 'user-1',
        participantB: 'user-2',
        bookingId: 'booking-1',
      });
      prisma.user.findUnique.mockResolvedValue({ role: 'CLIENT' });
      prisma.booking.findUnique.mockResolvedValue({ status: 'PENDING', actualEnd: null });

      expect(await service.canAccess('user-1', 'conv-1')).toBe(false);
    });
  });

  describe('uploadAttachment', () => {
    it('asks StorageService for a signed upload with the 10MB chat limit, in a per-conversation folder', async () => {
      const { service, storage } = buildService();
      storage.getUploadSignature.mockResolvedValue({ uploadUrl: 'https://cloudinary/upload' });

      await service.uploadAttachment('conv-1', 'image/png', 1000, 'photo.png');

      expect(storage.getUploadSignature).toHaveBeenCalledWith(
        expect.objectContaining({
          folder: 'chat/conv-1',
          maxSizeBytes: 10 * 1024 * 1024,
        }),
      );
    });
  });

  describe('markRead', () => {
    it('only marks messages from THE OTHER person as read, never your own sent messages', async () => {
      // Why: you don't need a "read receipt" on messages you sent yourself.
      const { service, prisma } = buildService();

      await service.markRead('conv-1', 'user-1');

      expect(prisma.message.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ senderId: { not: 'user-1' } }),
        }),
      );
    });
  });
});
