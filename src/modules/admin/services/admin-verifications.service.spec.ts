import { NotFoundException } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';
import { AdminVerificationsService } from './admin-verifications.service.js';

// 🧑‍⚖️ What is this file checking?
// This is where an admin approves, rejects, or asks for more documents
// on a worker's identity verification. The important behaviour: only an
// "approve" decision should actually flip the worker's profile over to
// VERIFIED — a rejection or "request more docs" must NOT accidentally
// verify them.

describe('AdminVerificationsService', () => {
  function buildService() {
    const prisma = {
      verification: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      workerProfile: { update: jest.fn() },
    } as any;
    const eventEmitter = { emit: jest.fn() } as any;
    return { service: new AdminVerificationsService(prisma, eventEmitter), prisma, eventEmitter };
  }

  describe('review', () => {
    it('throws when the verification submission does not exist', async () => {
      const { service, prisma } = buildService();
      prisma.verification.findUnique.mockResolvedValue(null);

      await expect(service.review('ghost', 'approve', undefined, 'admin-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('marks the worker profile VERIFIED only when the decision is "approve"', async () => {
      const { service, prisma } = buildService();
      prisma.verification.findUnique.mockResolvedValue({ id: 'v1', userId: 'worker-1' });

      await service.review('v1', 'approve', undefined, 'admin-1');

      expect(prisma.workerProfile.update).toHaveBeenCalledWith({
        where: { userId: 'worker-1' },
        data: { verificationStatus: VerificationStatus.VERIFIED },
      });
    });

    it('does NOT touch the worker profile when the decision is "reject"', async () => {
      // Why: a rejected identity check should never accidentally verify the worker.
      const { service, prisma } = buildService();
      prisma.verification.findUnique.mockResolvedValue({ id: 'v1', userId: 'worker-1' });

      await service.review('v1', 'reject', 'ID photo unreadable', 'admin-1');

      expect(prisma.workerProfile.update).not.toHaveBeenCalled();
      expect(prisma.verification.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: VerificationStatus.REJECTED }) }),
      );
    });

    it('tells NotificationsModule about the status change so the worker gets notified', async () => {
      const { service, prisma, eventEmitter } = buildService();
      prisma.verification.findUnique.mockResolvedValue({ id: 'v1', userId: 'worker-1' });

      await service.review('v1', 'approve', undefined, 'admin-1');

      expect(eventEmitter.emit).toHaveBeenCalledWith('verification.status_changed', {
        userId: 'worker-1',
        status: VerificationStatus.VERIFIED,
      });
    });
  });
});
