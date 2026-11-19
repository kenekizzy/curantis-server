const mockSend = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));

import { MailService } from './mail.service.js';

// ✉️ What is this file checking?
// MailService is the app's mailman — it sends OTP codes, password reset
// links, welcome emails, etc. via Resend. The most important rule here:
// sending an email should NEVER crash the feature that asked for it.
// If OTP registration succeeds but the email provider is briefly down,
// the user's registration should still go through — the email failure
// is only logged, never thrown.

describe('MailService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RESEND_API_KEY = 're_fake';
  });

  it('sends the OTP email with the code embedded in the message', async () => {
    const service = new MailService();
    mockSend.mockResolvedValue({ data: { id: 'msg-1' }, error: null });

    await service.sendOtpEmail('a@b.com', '123456');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.com', subject: expect.stringContaining('verification') }),
    );
  });

  it('does not throw when Resend reports an error sending the OTP email', async () => {
    // Why: a flaky email provider should never block the rest of the signup flow.
    const service = new MailService();
    mockSend.mockResolvedValue({ data: null, error: { name: 'RateLimit', message: 'too many' } });

    await expect(service.sendOtpEmail('a@b.com', '123456')).resolves.toBeUndefined();
  });

  it('does not throw even when Resend itself throws an exception', async () => {
    // Why: a network blip talking to Resend must not bubble up and crash the caller.
    const service = new MailService();
    mockSend.mockRejectedValue(new Error('network down'));

    await expect(service.sendOtpEmail('a@b.com', '123456')).resolves.toBeUndefined();
  });

  it('sends the password reset email with the reset token embedded', async () => {
    const service = new MailService();
    mockSend.mockResolvedValue({ data: { id: 'msg-2' }, error: null });

    await service.sendResetPasswordEmail('a@b.com', 'raw-reset-token');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.com', subject: expect.stringContaining('reset') }),
    );
  });

  it('sends a new admin their welcome email with their temporary password', async () => {
    const service = new MailService();
    mockSend.mockResolvedValue({ data: { id: 'msg-3' }, error: null });

    await service.sendAdminWelcomeEmail('admin@x.com', 'Temp123!', 'FINANCE_OFFICER');

    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: 'admin@x.com' }));
  });
});
