import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WorkerType } from '@prisma/client';
import { ProfilesService } from './profiles.service.js';

// 📇 What is this file checking?
// ProfilesService is where a worker or client fills in "who am I" — name,
// bio, hourly rate, etc. Two things really matter here:
//   1. Money math: the hourly rate the user types in Naira (e.g. ₦4,500)
//      must be correctly converted to kobo (450000) before it's saved,
//      because this app never stores money as a decimal.
//   2. A Healthcare Student (HS) MUST say which school and graduation
//      year they're in — a Healthcare Worker (HW) doesn't need that.
//   3. The public version of a worker's profile must hide school details.

describe('ProfilesService', () => {
  function buildService() {
    const prisma = {
      workerProfile: { upsert: jest.fn(), update: jest.fn(), findUnique: jest.fn() },
      clientProfile: { upsert: jest.fn(), update: jest.fn() },
      user: { findUnique: jest.fn() },
    } as any;
    return { service: new ProfilesService(prisma), prisma };
  }

  describe('upsertWorkerProfile', () => {
    it('refuses a Healthcare Student profile that is missing institution or graduation year', async () => {
      // Why: HS workers are only trusted for non-regulated care once their
      // school is on file — we can't skip that check.
      const { service } = buildService();

      await expect(
        service.upsertWorkerProfile('user-1', {
          workerType: WorkerType.HS,
          hourlyRate: 3000,
          fullName: 'Amaka',
          state: 'Lagos',
          lga: 'Ikeja',
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('converts the hourly rate from Naira into kobo before saving', async () => {
      // Why: ₦4,500/hr must become 450000 kobo — the app's only accepted money format.
      const { service, prisma } = buildService();
      prisma.workerProfile.upsert.mockResolvedValue({});

      await service.upsertWorkerProfile('user-1', {
        workerType: WorkerType.HW,
        hourlyRate: 4500,
        fullName: 'Amaka',
        state: 'Lagos',
        lga: 'Ikeja',
      } as any);

      const call = prisma.workerProfile.upsert.mock.calls[0][0];
      expect(call.create.hourlyRateKobo).toBe(450000n);
    });
  });

  describe('patchWorkerProfile', () => {
    it('only sends the fields that were actually provided, leaving the rest untouched', async () => {
      // Why: a partial update (PATCH) shouldn't wipe out fields the caller didn't mention.
      const { service, prisma } = buildService();
      prisma.workerProfile.update.mockResolvedValue({});

      await service.patchWorkerProfile('user-1', { bio: 'Friendly and patient' } as any);

      expect(prisma.workerProfile.update).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: { bio: 'Friendly and patient' },
      });
    });
  });

  describe('getPublicWorkerProfile', () => {
    it('throws when the worker profile does not exist', async () => {
      // Why: viewing a caregiver that isn't there should read as "not found", not crash.
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue(null);

      await expect(service.getPublicWorkerProfile('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('never asks Prisma to select school/institution details for the public view', async () => {
      // Why: institution, gradYear, and fieldOfStudy are private — clients
      // shouldn't see a student worker's school info on the public profile.
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue({ id: 'wp-1' });

      await service.getPublicWorkerProfile('wp-1');

      const selectArg = prisma.workerProfile.findUnique.mock.calls[0][0].select;
      expect(selectArg.institution).toBeUndefined();
      expect(selectArg.gradYear).toBeUndefined();
      expect(selectArg.fieldOfStudy).toBeUndefined();
    });
  });
});
