import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service.js';

// 🔑 What is this file checking?
// AuthService is the front-door security guard for the whole app: it
// decides who is allowed to sign up, log in, get a new "visitor badge"
// (JWT), or reset a forgotten password. We test it like a very strict
// checklist:
//   - Does it say NO to people who shouldn't get in (wrong password,
//     account already suspended, too many tries)?
//   - Does it say YES the right way to people who should get in?
// We never talk to a real database, a real Redis, or send real emails —
// we use pretend versions ("mocks") that just remember what was asked of them.

jest.mock('bcrypt', () => ({
  hash: jest.fn(async (value: string) => `hashed:${value}`),
  compare: jest.fn(async (value: string, hash: string) => hash === `hashed:${value}`),
}));

describe('AuthService', () => {
  let prisma: any;
  let redis: any;
  let jwt: any;
  let notifQueue: any;
  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
      refreshToken: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      adminProfile: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    redis = {
      setex: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn(),
    };
    jwt = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    notifQueue = { add: jest.fn() };

    process.env.JWT_PRIVATE_KEY = 'fake-private-key';

    service = new AuthService(prisma, redis, jwt, notifQueue);
  });

  describe('register', () => {
    it('creates a new PENDING user and sends them an OTP when the email/phone is free', async () => {
      // Why: signing up should create the account and immediately kick off verification.
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'user-1' });

      const result = await service.register({
        email: 'a@b.com',
        phone: '08000000000',
        password: 'Password1!',
        role: 'CLIENT',
      } as any);

      expect(result).toEqual({ userId: 'user-1' });
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) }),
      );
      expect(notifQueue.add).toHaveBeenCalledWith('send-otp', expect.any(Object));
    });

    it('refuses to create a duplicate account for an email/phone that already exists', async () => {
      // Why: two people should never be able to register with the same email.
      prisma.user.findFirst.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.register({ email: 'a@b.com', password: 'x' } as any),
      ).rejects.toThrow(ConflictException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('verifyOtp', () => {
    it('returns false when there is no OTP on record for this identifier', async () => {
      // Why: nothing was ever sent, or it already expired — nothing to check against.
      redis.get.mockResolvedValue(null);

      const result = await service.verifyOtp('a@b.com', '123456');

      expect(result).toBe(false);
    });

    it('returns false when the code the user typed does not match', async () => {
      // Why: a wrong guess must never verify the account.
      redis.get.mockResolvedValue('hashed:999999');

      const result = await service.verifyOtp('a@b.com', '123456');

      expect(result).toBe(false);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('activates the account and clears the OTP when the code matches', async () => {
      // Why: correct code = welcome in, account becomes ACTIVE.
      redis.get.mockResolvedValue('hashed:123456');

      const result = await service.verifyOtp('a@b.com', '123456');

      expect(result).toBe(true);
      expect(redis.del).toHaveBeenCalledWith('otp:a@b.com');
      expect(prisma.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { emailVerified: true, status: 'ACTIVE' },
        }),
      );
      expect(notifQueue.add).toHaveBeenCalledWith(
        'send-successful-signup-email',
        expect.any(Object),
      );
    });
  });

  describe('login', () => {
    const user = { id: 'user-1', role: 'CLIENT', passwordHash: 'hashed:correct', status: 'ACTIVE' };

    it('rejects a login for an identifier that does not exist', async () => {
      // Why: don't let anyone in if there's no such account.
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.login('nobody@x.com', 'whatever', 'CLIENT')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects the wrong password', async () => {
      // Why: the classic case — bad password, no entry.
      prisma.user.findFirst.mockResolvedValue(user);

      await expect(service.login('a@b.com', 'wrong-password', 'CLIENT')).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('locks the account after too many failed attempts, even before checking the password', async () => {
      // Why: this stops someone from guessing passwords forever (brute force).
      prisma.user.findFirst.mockResolvedValue(user);
      redis.incr.mockResolvedValue(6);

      await expect(service.login('a@b.com', 'correct', 'CLIENT')).rejects.toThrow(ForbiddenException);
    });

    it('refuses a suspended account even with the correct password', async () => {
      // Why: a banned user shouldn't be able to log back in.
      prisma.user.findFirst.mockResolvedValue({ ...user, status: 'SUSPENDED' });

      await expect(service.login('a@b.com', 'correct', 'CLIENT')).rejects.toThrow(ForbiddenException);
    });

    it('logs in successfully and hands back a fresh access + refresh token', async () => {
      // Why: this is the everyday "it just works" case.
      prisma.user.findFirst.mockResolvedValue(user);
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.login('a@b.com', 'correct', 'CLIENT');

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(typeof result.refreshToken).toBe('string');
      expect(redis.del).toHaveBeenCalledWith('login-attempts:user-1');
    });
  });

  describe('refresh', () => {
    it('rejects a refresh token that is missing, expired, or already revoked', async () => {
      // Why: a stolen or old refresh token must never mint new tokens.
      prisma.refreshToken.findFirst.mockResolvedValue(null);

      await expect(service.refresh('some-raw-token')).rejects.toThrow(UnauthorizedException);
    });

    it('rotates the token: revokes the old one and issues a brand new pair', async () => {
      // Why: "rotation" means every refresh uses up the old token, so a leaked
      // token can only be replayed once before it stops working.
      prisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        user: { id: 'user-1', role: 'CLIENT' },
      });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.refresh('some-raw-token');

      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(result.accessToken).toBe('signed.jwt.token');
    });
  });

  describe('logout', () => {
    it('marks the current access token as revoked so it cannot be reused', async () => {
      // Why: once you log out, that exact token should stop working immediately.
      await service.logout('user-1', 'jti-1');

      expect(redis.setex).toHaveBeenCalledWith('revoked:jti-1', expect.any(Number), '1');
    });

    it('also revokes the matching refresh token when one is provided', async () => {
      // Why: logging out should kill both the short-lived and long-lived tokens.
      await service.logout('user-1', 'jti-1', 'raw-refresh-token');

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1' }) }),
      );
    });
  });

  describe('requestPasswordReset', () => {
    it('does nothing detectable when the account does not exist (no email leak)', async () => {
      // Why: telling a stranger "that email isn't registered" helps attackers
      // guess who has an account, so we quietly do nothing instead.
      prisma.user.findFirst.mockResolvedValue(null);

      await service.requestPasswordReset('nobody@x.com');

      expect(notifQueue.add).not.toHaveBeenCalled();
    });

    it('stores a reset token and emails a reset link when the account exists', async () => {
      // Why: the real, happy path for "I forgot my password".
      prisma.user.findFirst.mockResolvedValue({ id: 'user-1' });

      await service.requestPasswordReset('a@b.com');

      expect(redis.setex).toHaveBeenCalledWith(expect.stringMatching(/^reset:/), 3600, 'user-1');
      expect(notifQueue.add).toHaveBeenCalledWith('send-reset-link', expect.any(Object));
    });
  });

  describe('resetPassword', () => {
    it('rejects an invalid or expired reset link', async () => {
      // Why: an old or made-up token must not let anyone change a password.
      redis.get.mockResolvedValue(null);

      await expect(service.resetPassword('bad-token', 'NewPassword1!')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('sets the new password and logs the user out of every device', async () => {
      // Why: after a reset, every old session/refresh token should die —
      // otherwise someone who already had a stolen token could keep using it.
      redis.get.mockResolvedValue('user-1');

      await service.resetPassword('good-token', 'NewPassword1!');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: 'hashed:NewPassword1!' },
      });
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', revokedAt: null } }),
      );
    });
  });

  describe('loginWithGoogle', () => {
    it('reuses the existing account when the Google ID is already linked', async () => {
      // Why: the second time someone signs in with Google, we recognise them instantly.
      prisma.user.findUnique.mockResolvedValueOnce({ id: 'user-1', role: 'CLIENT' });

      const result = await service.loginWithGoogle('google-sub-1', 'a@b.com');

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('links the Google ID to a matching email account if one exists but was not linked yet', async () => {
      // Why: someone who registered with email/password should be able to
      // later "Sign in with Google" using the same email, and it just links up.
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // no user with this googleSub yet
        .mockResolvedValueOnce({ id: 'user-1', role: 'CLIENT' }); // but email matches
      prisma.user.update.mockResolvedValue({ id: 'user-1', role: 'CLIENT' });

      await service.loginWithGoogle('google-sub-1', 'a@b.com');

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { googleSub: 'google-sub-1' },
      });
    });

    it('creates a brand new account when nobody matches by Google ID or email', async () => {
      // Why: first time ever seeing this person — welcome them as a new CLIENT.
      prisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValue({ id: 'user-new', role: 'CLIENT' });

      await service.loginWithGoogle('google-sub-2', 'new@b.com');

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ role: 'CLIENT' }) }),
      );
    });
  });

  describe('loginAdmin', () => {
    it('rejects someone who has no admin profile even with the right password', async () => {
      // Why: being ADMIN-role isn't enough on its own — they must have an AdminProfile too.
      prisma.user.findFirst.mockResolvedValue({
        id: 'admin-1',
        role: 'ADMIN',
        passwordHash: 'hashed:correct',
        status: 'ACTIVE',
      });
      prisma.adminProfile.findUnique.mockResolvedValue(null);

      await expect(service.loginAdmin('admin@x.com', 'correct')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('logs an admin in and reports back their admin role', async () => {
      // Why: the admin dashboard needs to know "which kind of admin is this" right away.
      prisma.user.findFirst.mockResolvedValue({
        id: 'admin-1',
        role: 'ADMIN',
        passwordHash: 'hashed:correct',
        status: 'ACTIVE',
      });
      prisma.adminProfile.findUnique.mockResolvedValue({ adminRole: 'SUPER_ADMIN' });
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.loginAdmin('admin@x.com', 'correct');

      expect(result.adminRole).toBe('SUPER_ADMIN');
      expect(result.accessToken).toBe('signed.jwt.token');
    });
  });

  describe('createNewAdmin', () => {
    it('refuses when the person creating the admin is not a Super Admin', async () => {
      // Why: only the top-level admin should be allowed to hand out new admin accounts.
      prisma.adminProfile.findUnique.mockResolvedValue({ adminRole: 'SUPPORT_AGENT' });

      await expect(
        service.createNewAdmin('caller-1', 'new-admin@x.com', 'Password1!', 'FINANCE_OFFICER' as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('creates the new admin account and emails them their credentials', async () => {
      // Why: the happy path — a Super Admin onboards a new teammate.
      prisma.adminProfile.findUnique.mockResolvedValue({ adminRole: 'SUPER_ADMIN' });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ id: 'new-admin-1', email: 'new-admin@x.com' });

      await service.createNewAdmin('caller-1', 'new-admin@x.com', 'Password1!', 'FINANCE_OFFICER' as any);

      expect(prisma.adminProfile.create).toHaveBeenCalledWith({
        data: { userId: 'new-admin-1', adminRole: 'FINANCE_OFFICER' },
      });
      expect(notifQueue.add).toHaveBeenCalledWith('send-admin-welcome', expect.any(Object));
    });
  });

  describe('deleteAdmin', () => {
    it('refuses when the caller is not a Super Admin', async () => {
      // Why: removing an admin is powerful and dangerous — only the top role can do it.
      prisma.adminProfile.findUnique.mockResolvedValue({ adminRole: 'FINANCE_OFFICER' });

      await expect(service.deleteAdmin('caller-1', 'target-admin')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('deletes the admin profile and the underlying user account', async () => {
      // Why: removing an admin should fully remove their access, not just half of it.
      prisma.adminProfile.findUnique.mockResolvedValue({ adminRole: 'SUPER_ADMIN' });

      await service.deleteAdmin('caller-1', 'target-admin');

      expect(prisma.adminProfile.delete).toHaveBeenCalledWith({ where: { userId: 'target-admin' } });
      expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'target-admin' } });
    });
  });
});
