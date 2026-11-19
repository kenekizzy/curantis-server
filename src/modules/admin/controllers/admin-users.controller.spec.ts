import { AdminUsersController } from './admin-users.controller.js';

// 👮 What is this file checking?
// This is how an admin suspends, reactivates, or deactivates a user
// account. The one thing worth checking: every status change must leave
// an audit trail behind, tagged with exactly which new status was applied
// (e.g. "USER_SUSPENDED"), so there's a clear paper trail of who did what.

describe('AdminUsersController', () => {
  it('updates the user\'s status and writes a matching audit log entry', async () => {
    const prisma = { user: { update: jest.fn().mockResolvedValue({ id: 'user-1', status: 'SUSPENDED' }) } } as any;
    const adminLogger = { log: jest.fn() } as any;
    const controller = new AdminUsersController(prisma, adminLogger);
    const admin = { sub: 'admin-1' } as any;

    await controller.updateStatus('user-1', { status: 'SUSPENDED', reason: 'fraud report' }, admin);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' }, data: { status: 'SUSPENDED' } }),
    );
    expect(adminLogger.log).toHaveBeenCalledWith(
      'admin-1',
      'USER_SUSPENDED',
      'user',
      'user-1',
      'fraud report',
    );
  });
});
