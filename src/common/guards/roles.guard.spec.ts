import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard.js';

// 🎫 What is this file checking?
// Imagine a theme park ride with a sign that says "HW and HS only".
// RolesGuard is the ride attendant who checks your wristband (your role
// from the JWT) against that sign before letting you on.
// - No sign at all? Everyone can ride.
// - Sign says "HW and HS only" and you're a CLIENT? You get turned away.
// - Sign says "HW and HS only" and you're an HW? You're good to go.

describe('RolesGuard', () => {
  function buildContext(requiredRoles: Role[] | undefined, userRole: Role) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
    } as unknown as Reflector;

    const context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: userRole } }),
      }),
    } as any;

    return { guard: new RolesGuard(reflector), context };
  }

  it('lets anyone through when the route has no @Roles() restriction', () => {
    // Why: most routes don't care which role you have, just that you're logged in.
    const { guard, context } = buildContext(undefined, Role.CLIENT);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('lets the user through when their role is on the allowed list', () => {
    // Why: an HW hitting an "HW-only" route should just work.
    const { guard, context } = buildContext([Role.HW, Role.HS], Role.HW);

    expect(guard.canActivate(context)).toBe(true);
  });

  it('blocks the user when their role is NOT on the allowed list', () => {
    // Why: a CLIENT should never be able to act like a worker.
    const { guard, context } = buildContext([Role.HW, Role.HS], Role.CLIENT);

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
