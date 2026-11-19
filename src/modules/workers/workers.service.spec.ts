import { NotFoundException } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';
import { WorkersService } from './workers.service.js';

// 🔍 What is this file checking?
// This is the "find me a caregiver" search engine. The important rules:
//   1. It must NEVER show a worker who isn't verified or who paused
//      their availability — safety first.
//   2. It remembers recent search results in Redis for 60 seconds
//      (a "cache") so the database isn't hit every single time someone
//      searches the same thing.
//   3. It should never leak a worker's school/institution info to the
//      public search results.

describe('WorkersService', () => {
  function buildService() {
    const prisma = {
      workerProfile: { findMany: jest.fn(), findUnique: jest.fn() },
      availabilitySlot: { findMany: jest.fn() },
      availabilityBlock: { findMany: jest.fn() },
    } as any;
    const redis = { get: jest.fn(), setex: jest.fn() } as any;
    return { service: new WorkersService(prisma, redis), prisma, redis };
  }

  describe('search', () => {
    it('returns a cached result straight away without touching the database', async () => {
      // Why: caching means the second identical search is instant and free.
      const { service, prisma, redis } = buildService();
      redis.get.mockResolvedValue(JSON.stringify({ items: [{ id: 'cached-1' }], meta: {} }));

      const result = await service.search({} as any);

      expect(result).toEqual({ items: [{ id: 'cached-1' }], meta: {} });
      expect(prisma.workerProfile.findMany).not.toHaveBeenCalled();
    });

    it('only ever searches for VERIFIED, available workers', async () => {
      // Why: an unverified or paused worker should be invisible in search results.
      const { service, prisma, redis } = buildService();
      redis.get.mockResolvedValue(null);
      prisma.workerProfile.findMany.mockResolvedValue([]);

      await service.search({} as any);

      const whereArg = prisma.workerProfile.findMany.mock.calls[0][0].where;
      expect(whereArg.verificationStatus).toBe(VerificationStatus.VERIFIED);
      expect(whereArg.isAvailable).toBe(true);
    });

    it('caches the fresh result for 60 seconds after a real database search', async () => {
      // Why: the next identical search within a minute should hit the cache instead.
      const { service, prisma, redis } = buildService();
      redis.get.mockResolvedValue(null);
      prisma.workerProfile.findMany.mockResolvedValue([{ id: 'w-1', hourlyRateKobo: 500000n }]);

      await service.search({} as any);

      expect(redis.setex).toHaveBeenCalledWith(expect.any(String), 60, expect.any(String));
      // Also proves BigInt money fields don't crash JSON.stringify when caching.
      const cachedJson = redis.setex.mock.calls[0][2];
      expect(cachedJson).toContain('"500000"');
    });

    it('sorts by price ascending when asked to', async () => {
      // Why: "cheapest first" is a common, real filter clients will use.
      const { service, prisma, redis } = buildService();
      redis.get.mockResolvedValue(null);
      prisma.workerProfile.findMany.mockResolvedValue([]);

      await service.search({ sort: 'price_asc' } as any);

      expect(prisma.workerProfile.findMany.mock.calls[0][0].orderBy).toEqual({
        hourlyRateKobo: 'asc',
      });
    });
  });

  describe('getPublicProfile', () => {
    it('throws when no worker profile matches the id', async () => {
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue(null);

      await expect(service.getPublicProfile('ghost')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getWorkerAvailability', () => {
    it('throws when the worker profile does not exist', async () => {
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue(null);

      await expect(service.getWorkerAvailability('ghost')).rejects.toThrow(NotFoundException);
    });

    it('returns both the weekly slots and any date blocks together', async () => {
      // Why: the caller needs the full picture — regular weekly hours PLUS
      // any one-off blocked dates (like a holiday) — in one response.
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue({ id: 'wp-1' });
      prisma.availabilitySlot.findMany.mockResolvedValue([{ dayOfWeek: 1 }]);
      prisma.availabilityBlock.findMany.mockResolvedValue([{ startDate: new Date() }]);

      const result = await service.getWorkerAvailability('user-1');

      expect(result.slots).toHaveLength(1);
      expect(result.blocks).toHaveLength(1);
    });
  });
});
