import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole } from '@prisma/client';
import { AdminRolesGuard } from './admin-roles.guard.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

// 🛂 What is this file checking?
// This is like RolesGuard's cousin, but for admins specifically. Instead
// of reading the role straight off the visitor's wristband (the JWT),
// it has to go check a filing cabinet (the database) to look up "what
// kind of admin is this person actually registered as?" — because admin
// roles (Super Admin, Finance Officer, etc.) live in their own table.
//
// Three things to check:
//   1. No sign posted → let everyone through, don't even open the cabinet.
//   2. Sign posted, but this person isn't an admin at all → turned away.
//   3. Sign posted, and their admin role matches → let them through.

describe('AdminRolesGuard', () => {
  function buildGuard() {
    const prisma = {
      adminProfile: { findUnique: jest.fn() },
    } as unknown as PrismaService;
    const reflector = { getAllAndOverride: jest.fn() } as unknown as Reflector;
    return { guard: new AdminRolesGuard(reflector, prisma), prisma, reflector };
  }

  function buildContext(userId = 'user-1') {
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user: { sub: userId } }) }),
    } as any;
  }

  it('skips the database lookup entirely when no @AdminRoles() restriction is set', async () => {
    // Why: cheap fast-path — most requests shouldn't pay for a DB round trip.
    const { guard, prisma, reflector } = buildGuard();
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);

    const result = await guard.canActivate(buildContext());

    expect(result).toBe(true);
    expect(prisma.adminProfile.findUnique).not.toHaveBeenCalled();
  });

  it('blocks the request when the caller has no admin profile at all', async () => {
    // Why: a regular user token should never be treated as an admin.
    const { guard, prisma, reflector } = buildGuard();
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([AdminRole.SUPER_ADMIN]);
    (prisma.adminProfile.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(guard.canActivate(buildContext())).rejects.toThrow(ForbiddenException);
  });

  it('blocks the request when the admin exists but has the wrong admin role', async () => {
    // Why: a Support Agent shouldn't be able to do Super-Admin-only things.
    const { guard, prisma, reflector } = buildGuard();
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([AdminRole.SUPER_ADMIN]);
    (prisma.adminProfile.findUnique as jest.Mock).mockResolvedValue({
      adminRole: AdminRole.SUPPORT_AGENT,
    });

    await expect(guard.canActivate(buildContext())).rejects.toThrow(ForbiddenException);
  });

  it('lets the request through when the admin role matches', async () => {
    // Why: the whole point of the guard — the right admin gets to act.
    const { guard, prisma, reflector } = buildGuard();
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([AdminRole.SUPER_ADMIN]);
    (prisma.adminProfile.findUnique as jest.Mock).mockResolvedValue({
      adminRole: AdminRole.SUPER_ADMIN,
    });

    await expect(guard.canActivate(buildContext())).resolves.toBe(true);
  });
});
