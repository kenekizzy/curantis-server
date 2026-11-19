
import { Reflector } from '@nestjs/core';

// 🚪 What is this file checking?
// Think of JwtAuthGuard as a bouncer standing at the door of every room
// (every API route) in our app. Before letting anyone in, the bouncer
// checks: "Did the room's owner put up a sign that says PUBLIC — anyone
// can walk in?" If yes, they wave everyone through without checking ID.
// If no sign, they ask the normal bouncer (Passport's JWT check) to look
// at the visitor's ID card (the JWT token) before deciding.
//
// These tests only check the "did you see the PUBLIC sign?" part — the
// real ID-checking is Passport's job, so we replace Passport's base guard
// with a fake one we fully control.

const superCanActivate = jest.fn().mockReturnValue('super-result');

jest.mock('@nestjs/passport', () => ({
  AuthGuard: () =>
    class {
      canActivate(...args: unknown[]) {
        return superCanActivate(...args);
      }
    },
}));

// Imported after the mock above so it picks up the fake AuthGuard base class.
import { JwtAuthGuard } from './jwt-auth.guard.js';

describe('JwtAuthGuard', () => {
  const context = { getHandler: jest.fn(), getClass: jest.fn() } as any;

  beforeEach(() => {
    superCanActivate.mockClear();
  });

  function buildGuard(isPublicReturnValue: boolean | undefined) {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(isPublicReturnValue),
    } as unknown as Reflector;
    return { guard: new JwtAuthGuard(reflector), reflector };
  }

  it('lets everyone in when the route is marked @Public()', () => {
    // Why: some routes (like login or health checks) should never require a token.
    const { guard } = buildGuard(true);

    const result = guard.canActivate(context);

    expect(result).toBe(true);
    expect(superCanActivate).not.toHaveBeenCalled();
  });

  it('asks Passport to check the JWT when the route is NOT marked @Public()', () => {
    // Why: every other route must prove who the caller is before continuing.
    const { guard } = buildGuard(false);

    const result = guard.canActivate(context);

    expect(superCanActivate).toHaveBeenCalledWith(context);
    expect(result).toBe('super-result');
  });

  it('also checks Passport when nobody set the @Public() metadata at all', () => {
    // Why: routes are locked down by default unless explicitly opened up.
    const { guard } = buildGuard(undefined);

    guard.canActivate(context);

    expect(superCanActivate).toHaveBeenCalledWith(context);
  });
});
