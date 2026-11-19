// 📬 What is this file checking?
// This is the worker that actually DOES the notification work queued up
// by NotificationsListener: saving a notification row so it shows up in
// the bell icon, and emailing the user about it. It also handles a bunch
// of one-off email jobs (OTP, password reset, admin welcome, etc.) by
// simply forwarding them to MailService. The one real branch of logic
// worth checking: a "send-notification" job with no userId (like a
// generic payment confirmation with no specific recipient) should just
// be skipped, not crash.

const mockSend = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));

import { NotificationsProcessor } from './notifications.processor.js';

describe('NotificationsProcessor', () => {
  function buildProcessor() {
    const prisma = {
      notification: { create: jest.fn(), createMany: jest.fn() },
      user: { findUnique: jest.fn(), findMany: jest.fn() },
    } as any;
    const mailService = {
      sendOtpEmail: jest.fn(),
      sendResetPasswordEmail: jest.fn(),
      sendSuccessfulEmailSignUp: jest.fn(),
      sendAdminWelcomeEmail: jest.fn(),
      sendAdminPasswordUpdateEmail: jest.fn(),
    } as any;
    return { processor: new NotificationsProcessor(prisma, mailService), prisma, mailService };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RESEND_API_KEY = 're_fake';
  });

  describe('send-notification', () => {
    it('does nothing when the job has no userId at all', async () => {
      // Why: some events (like a generic payment confirmation) aren't
      // addressed to anyone specific — nothing to save or send.
      const { processor, prisma } = buildProcessor();

      await processor.process({ name: 'send-notification', data: { type: 'PAYMENT_CONFIRMED' } } as any);

      expect(prisma.notification.create).not.toHaveBeenCalled();
    });

    it('saves the notification and emails the user when they have an email on file', async () => {
      // Why: the bell icon AND the inbox should both reflect this update.
      const { processor, prisma } = buildProcessor();
      prisma.user.findUnique.mockResolvedValue({ email: 'a@b.com' });
      mockSend.mockResolvedValue({ data: { id: 'msg-1' }, error: null });

      await processor.process({
        name: 'send-notification',
        data: { userId: 'user-1', type: 'BOOKING_ACCEPTED', bookingId: 'b1' },
      } as any);

      expect(prisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1' }) }),
      );
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'a@b.com', subject: 'Your booking was accepted' }),
      );
    });

    it('still saves the notification even when the user has no email on file', async () => {
      // Why: the in-app bell icon shouldn't depend on having an email address.
      const { processor, prisma } = buildProcessor();
      prisma.user.findUnique.mockResolvedValue({ email: null });

      await processor.process({
        name: 'send-notification',
        data: { userId: 'user-1', type: 'BOOKING_ACCEPTED' },
      } as any);

      expect(prisma.notification.create).toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('alert-super-admin', () => {
    it('creates one urgent notification for every admin user', async () => {
      // Why: a safeguarding alert must reach EVERY admin, not just one.
      const { processor, prisma } = buildProcessor();
      prisma.user.findMany.mockResolvedValue([{ id: 'admin-1' }, { id: 'admin-2' }]);

      await processor.process({
        name: 'alert-super-admin',
        data: { reportId: 'r1', category: 'safety_concern' },
      } as any);

      const createManyArg = prisma.notification.createMany.mock.calls[0][0].data;
      expect(createManyArg).toHaveLength(2);
      expect(createManyArg.every((n: any) => n.type === 'SAFEGUARDING_ALERT')).toBe(true);
    });

    it('does nothing if there happen to be no admin users at all', async () => {
      const { processor, prisma } = buildProcessor();
      prisma.user.findMany.mockResolvedValue([]);

      await processor.process({
        name: 'alert-super-admin',
        data: { reportId: 'r1', category: 'safety_concern' },
      } as any);

      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });
  });

  describe('email-only job types', () => {
    it('forwards a "send-otp" job straight to MailService.sendOtpEmail', async () => {
      const { processor, mailService } = buildProcessor();

      await processor.process({
        name: 'send-otp',
        data: { identifier: 'a@b.com', otp: '123456' },
      } as any);

      expect(mailService.sendOtpEmail).toHaveBeenCalledWith('a@b.com', '123456');
    });

    it('forwards a "send-admin-welcome" job straight to MailService.sendAdminWelcomeEmail', async () => {
      const { processor, mailService } = buildProcessor();

      await processor.process({
        name: 'send-admin-welcome',
        data: { email: 'admin@x.com', password: 'Temp123!', adminRole: 'FINANCE_OFFICER' },
      } as any);

      expect(mailService.sendAdminWelcomeEmail).toHaveBeenCalledWith(
        'admin@x.com',
        'Temp123!',
        'FINANCE_OFFICER',
      );
    });
  });
});
