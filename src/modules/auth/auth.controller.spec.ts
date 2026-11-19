import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller.js';

// 🚦 What is this file checking?
// AuthController is the "receptionist" — it takes HTTP requests, hands
// the real work to AuthService, and packages the response back up
// (including setting a secure cookie with the refresh token). We already
// tested all the hard decision-making in auth.service.spec.ts, so here we
// only check the receptionist's own little jobs:
//   - putting the refresh token in a cookie correctly
//   - refusing to even try refreshing if there's no cookie at all
//   - turning "OTP was wrong" into the right kind of error

function buildResponse() {
  return { cookie: jest.fn(), clearCookie: jest.fn() } as any;
}

describe('AuthController', () => {
  let authService: any;
  let controller: AuthController;

  beforeEach(() => {
    authService = {
      register: jest.fn(),
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      verifyOtp: jest.fn(),
      sendOtp: jest.fn(),
      requestPasswordReset: jest.fn(),
      resetPassword: jest.fn(),
      loginWithGoogle: jest.fn(),
    };
    controller = new AuthController(authService);
  });

  describe('login', () => {
    it('logs in, then stores the refresh token in a secure cookie and returns only the access token', async () => {
      // Why: the refresh token must never be visible to frontend JavaScript
      // (that's what HttpOnly cookies are for) — only the access token goes in the body.
      authService.login.mockResolvedValue({ accessToken: 'access-1', refreshToken: 'refresh-1' });
      const res = buildResponse();

      const result = await controller.login({ identifier: 'a@b.com', password: 'x' } as any, res);

      expect(res.cookie).toHaveBeenCalledWith(
        'refresh_token',
        'refresh-1',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(result).toEqual({ accessToken: 'access-1' });
    });
  });

  describe('refresh', () => {
    it('refuses to refresh when the browser sent no refresh_token cookie at all', async () => {
      // Why: there's nothing to rotate if the cookie is missing.
      const req = { cookies: {} } as any;
      const res = buildResponse();

      await expect(controller.refresh(req, res)).rejects.toThrow(UnauthorizedException);
      expect(authService.refresh).not.toHaveBeenCalled();
    });

    it('rotates the token and sets the new refresh token cookie when one was sent', async () => {
      // Why: the everyday "silently refresh my access token" flow.
      authService.refresh.mockResolvedValue({ accessToken: 'access-2', refreshToken: 'refresh-2' });
      const req = { cookies: { refresh_token: 'old-refresh' } } as any;
      const res = buildResponse();

      const result = await controller.refresh(req, res);

      expect(authService.refresh).toHaveBeenCalledWith('old-refresh');
      expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-2', expect.any(Object));
      expect(result).toEqual({ accessToken: 'access-2' });
    });
  });

  describe('logout', () => {
    it('clears the refresh token cookie after logging out', async () => {
      // Why: leaving a dead cookie behind in the browser would be untidy and confusing.
      const req = { cookies: { refresh_token: 'raw-refresh' } } as any;
      const res = buildResponse();

      const result = await controller.logout(
        { sub: 'user-1', jti: 'jti-1' } as any,
        req,
        res,
      );

      expect(authService.logout).toHaveBeenCalledWith('user-1', 'jti-1', 'raw-refresh');
      expect(res.clearCookie).toHaveBeenCalledWith('refresh_token');
      expect(result).toEqual({ success: true });
    });
  });

  describe('verifyOtp', () => {
    it('turns an invalid/expired code into a clear 400 error', async () => {
      // Why: the frontend needs a real HTTP error to show "wrong code" to the user.
      authService.verifyOtp.mockResolvedValue(false);

      await expect(
        controller.verifyOtp({ identifier: 'a@b.com', code: '000000' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('confirms verification when the code is correct', async () => {
      // Why: the happy path — tell the frontend it worked.
      authService.verifyOtp.mockResolvedValue(true);

      const result = await controller.verifyOtp({ identifier: 'a@b.com', code: '123456' } as any);

      expect(result).toEqual({ verified: true });
    });
  });

  describe('googleCallback', () => {
    it('logs the Google user in and sets the refresh token cookie', async () => {
      // Why: after Google redirects back to us, we still follow the same
      // "issue tokens + set cookie" pattern as a normal login.
      authService.loginWithGoogle.mockResolvedValue({
        accessToken: 'access-3',
        refreshToken: 'refresh-3',
      });
      const req = { user: { googleSub: 'g-1', email: 'a@b.com' } } as any;
      const res = buildResponse();

      const result = await controller.googleCallback(req, res);

      expect(authService.loginWithGoogle).toHaveBeenCalledWith('g-1', 'a@b.com');
      expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-3', expect.any(Object));
      expect(result).toEqual({ accessToken: 'access-3' });
    });
  });
});
