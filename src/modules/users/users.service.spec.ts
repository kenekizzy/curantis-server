import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service.js';

// 🙋 What is this file checking?
// UsersService answers two simple questions:
//   1. "Tell me about this user" (but only the safe, public-ish fields —
//      never the password hash!)
//   2. "Update this user's email/phone"
// The main thing worth checking is what happens when someone asks about
// a user that doesn't exist.

describe('UsersService', () => {
  function buildService() {
    const prisma = {
      user: { findUnique: jest.fn(), update: jest.fn() },
    } as any;
    return { service: new UsersService(prisma), prisma };
  }

  describe('findById', () => {
    it('throws a 404-style error when the user does not exist', async () => {
      // Why: the profile page shouldn't crash — it should clearly say "not found".
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.findById('ghost-id')).rejects.toThrow(NotFoundException);
    });

    it('returns the user when found, without ever asking Prisma for the password hash', async () => {
      // Why: even if a caller made a mistake, we should never even fetch
      // the passwordHash for a "show my profile" request.
      const { service, prisma } = buildService();
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@b.com' });

      const result = await service.findById('user-1');

      expect(result).toEqual({ id: 'user-1', email: 'a@b.com' });
      const selectArg = prisma.user.findUnique.mock.calls[0][0].select;
      expect(selectArg.passwordHash).toBeUndefined();
    });
  });

  describe('update', () => {
    it('passes the new details straight through to Prisma and returns the updated user', async () => {
      // Why: this is a simple pass-through — no extra business rules to bend.
      const { service, prisma } = buildService();
      prisma.user.update.mockResolvedValue({ id: 'user-1', email: 'new@b.com' });

      const result = await service.update('user-1', { email: 'new@b.com' } as any);

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-1' }, data: { email: 'new@b.com' } }),
      );
      expect(result).toEqual({ id: 'user-1', email: 'new@b.com' });
    });
  });
});
