import { AdminLoggerService } from './admin-logger.service.js';

// 🧾 What is this file checking?
// Every action an admin takes (cancel a booking, approve a verification,
// issue a refund...) gets written to a permanent audit log — who did
// what, to what, and why. This is a simple, append-only recorder, so we
// just check it writes exactly the fields it was given.

describe('AdminLoggerService', () => {
  it('writes every field of the admin action to the audit log', async () => {
    const prisma = { adminLog: { create: jest.fn() } } as any;
    const service = new AdminLoggerService(prisma);

    await service.log('admin-1', 'BOOKING_CANCELLED', 'booking', 'booking-1', 'client requested');

    expect(prisma.adminLog.create).toHaveBeenCalledWith({
      data: {
        adminId: 'admin-1',
        action: 'BOOKING_CANCELLED',
        targetType: 'booking',
        targetId: 'booking-1',
        reason: 'client requested',
        metadata: undefined,
      },
    });
  });
});
