import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { CredentialStatus } from '@prisma/client';
import { VerificationService } from './verification.service.js';

// 🪪 What is this file checking?
// Before a caregiver can accept jobs, admins must check their real-world
// ID (identity verification) and, for Healthcare Workers, their
// professional certificates (credentials). This service is the intake
// desk for both of those. We check the important gate-keeping rules:
//   - you can't submit a second identity check while one is still pending
//   - only Healthcare Workers (HW) can submit professional credentials
//   - you can only delete your OWN credential, and only before it's been reviewed
//   - credentials with an expiry date get two reminder jobs queued (60 & 30 days before)

describe('VerificationService', () => {
  function buildService() {
    const prisma = {
      verification: { findFirst: jest.fn(), create: jest.fn() },
      workerProfile: { findUnique: jest.fn() },
      credential: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), delete: jest.fn() },
    } as any;
    const verificationQueue = { add: jest.fn() } as any;
    return { service: new VerificationService(prisma, verificationQueue), prisma, verificationQueue };
  }

  describe('submitIdentity', () => {
    it('refuses a new submission while a previous one is still PENDING', async () => {
      // Why: no spamming the review queue with duplicate submissions.
      const { service, prisma } = buildService();
      prisma.verification.findFirst.mockResolvedValue({ id: 'existing' });

      await expect(
        service.submitIdentity('user-1', { idDocUrl: 'x', selfieUrl: 'y' } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('queues an NIN lookup job only when a NIN was actually provided', async () => {
      // Why: not everyone provides their NIN up front, so we shouldn't
      // queue a lookup job for a NIN that doesn't exist.
      const { service, prisma, verificationQueue } = buildService();
      prisma.verification.findFirst.mockResolvedValue(null);
      prisma.verification.create.mockResolvedValue({ id: 'v-1' });

      await service.submitIdentity('user-1', {
        idDocUrl: 'x',
        selfieUrl: 'y',
        nin: '12345678901',
      } as any);

      expect(verificationQueue.add).toHaveBeenCalledWith('nin-lookup', {
        verificationId: 'v-1',
        nin: '12345678901',
      });
    });
  });

  describe('submitCredential', () => {
    it('refuses when the caller is not a Healthcare Worker', async () => {
      // Why: only licensed HWs carry professional credentials (HS students don't).
      const { service } = buildService();

      await expect(
        service.submitCredential('user-1', { title: 'RN Licence' } as any, 'HS'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses when the caller has no worker profile at all', async () => {
      // Why: you need a profile before you can attach credentials to it.
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue(null);

      await expect(
        service.submitCredential('user-1', { title: 'RN Licence' } as any, 'HW'),
      ).rejects.toThrow(NotFoundException);
    });

    it('queues two expiry-reminder jobs (60 days and 30 days out) when the credential has an expiry date', async () => {
      // Why: workers need a heads-up before their licence lapses.
      const { service, prisma, verificationQueue } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue({ id: 'wp-1' });
      const expiresAt = new Date(Date.now() + 200 * 24 * 60 * 60 * 1000);
      prisma.credential.create.mockResolvedValue({ id: 'cred-1', expiresAt });

      await service.submitCredential(
        'user-1',
        { title: 'RN Licence', issuingBody: 'NMCN', documentUrl: 'x', expiresAt: expiresAt.toISOString() } as any,
        'HW',
      );

      const reminderCalls = verificationQueue.add.mock.calls.filter(
        ([name]: [string]) => name === 'credential-expiry-reminder',
      );
      expect(reminderCalls).toHaveLength(2);
      expect(reminderCalls.map(([, payload]: [string, any]) => payload.daysOut).sort()).toEqual([
        30, 60,
      ]);
    });

    it('does not queue any reminders when the credential has no expiry date', async () => {
      // Why: some credentials (like a permanent licence) never expire.
      const { service, prisma, verificationQueue } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue({ id: 'wp-1' });
      prisma.credential.create.mockResolvedValue({ id: 'cred-1', expiresAt: null });

      await service.submitCredential(
        'user-1',
        { title: 'RN Licence', issuingBody: 'NMCN', documentUrl: 'x' } as any,
        'HW',
      );

      expect(verificationQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('deleteCredential', () => {
    it('refuses to delete a credential that belongs to someone else', async () => {
      // Why: workers must never be able to delete another worker's credential.
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue({ id: 'wp-1' });
      prisma.credential.findUnique.mockResolvedValue({ id: 'cred-1', workerId: 'someone-elses-wp' });

      await expect(service.deleteCredential('user-1', 'cred-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses to delete a credential that has already been reviewed', async () => {
      // Why: once an admin has approved/rejected it, it becomes a permanent record.
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue({ id: 'wp-1' });
      prisma.credential.findUnique.mockResolvedValue({
        id: 'cred-1',
        workerId: 'wp-1',
        status: CredentialStatus.VERIFIED,
      });

      await expect(service.deleteCredential('user-1', 'cred-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deletes the credential when it is the owner\'s own and still PENDING', async () => {
      // Why: the everyday case — "I made a typo, let me remove it before review."
      const { service, prisma } = buildService();
      prisma.workerProfile.findUnique.mockResolvedValue({ id: 'wp-1' });
      prisma.credential.findUnique.mockResolvedValue({
        id: 'cred-1',
        workerId: 'wp-1',
        status: CredentialStatus.PENDING,
      });
      prisma.credential.delete.mockResolvedValue({ id: 'cred-1' });

      await service.deleteCredential('user-1', 'cred-1');

      expect(prisma.credential.delete).toHaveBeenCalledWith({ where: { id: 'cred-1' } });
    });
  });
});
