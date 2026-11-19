import { AdminAuthController } from './admin-auth.controller.js';

// 🔐 What is this file checking?
// This is the admin dashboard's own login door — separate from the
// regular client/worker login. The one thing worth checking here (the
// service layer already covers the real security logic): a successful
// admin login must return their adminRole alongside the token, since
// the admin dashboard UI needs to know that immediately to decide what
// to show.

describe('AdminAuthController', () => {
  it('logs the admin in, sets the refresh cookie, and returns the adminRole with the access token', async () => {
    const authService = {
      loginAdmin: jest
        .fn()
        .mockResolvedValue({ accessToken: 'access-1', refreshToken: 'refresh-1', adminRole: 'SUPER_ADMIN' }),
    } as any;
    const controller = new AdminAuthController(authService);
    const res = { cookie: jest.fn() } as any;

    const result = await controller.login({ identifier: 'admin@x.com', password: 'x' } as any, res);

    expect(res.cookie).toHaveBeenCalledWith('refresh_token', 'refresh-1', expect.any(Object));
    expect(result).toEqual({ accessToken: 'access-1', adminRole: 'SUPER_ADMIN' });
  });
});
