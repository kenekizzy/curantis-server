import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReportsService } from './reports.service.js';

// 🚨 What is this file checking?
// Reports are how clients/workers flag a problem — anything from "this
// caregiver was late" to a serious safeguarding concern. Two important
// behaviours:
//   1. Safety-critical categories (safety_concern, misconduct) must
//      immediately escalate to a Super Admin — no waiting for review.
//   2. If someone reports a person who has no real booking relationship
//      with them, we still record it, but flag it as "unverified" so
//      admins know to double-check the claim.

describe('ReportsService', () => {
  function buildService() {
    const prisma = {
      booking: { findUnique: jest.fn() },
      report: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    } as any;
    const eventEmitter = { emit: jest.fn() } as any;
    return { service: new ReportsService(prisma, eventEmitter), prisma, eventEmitter };
  }

  describe('create', () => {
    it('refuses a report with more than 3 attached images', async () => {
      // Why: keeps reports reviewable — not an unlimited photo dump.
      const { service } = buildService();

      await expect(
        service.create('user-1', {
          accusedId: 'user-2',
          category: 'other',
          description: 'x',
          imageUrls: ['a', 'b', 'c', 'd'],
        } as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('immediately escalates a "safety_concern" report to a Super Admin', async () => {
      // Why: safeguarding issues can't wait in a normal review queue.
      const { service, prisma, eventEmitter } = buildService();
      prisma.report.create.mockResolvedValue({ id: 'report-1' });

      await service.create('user-1', {
        accusedId: 'user-2',
        category: 'safety_concern',
        description: 'x',
      } as any);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'report.escalated',
        expect.objectContaining({ reportId: 'report-1' }),
      );
    });

    it('does NOT escalate an everyday, non-safeguarding report category', async () => {
      // Why: escalation is reserved for genuinely urgent categories only.
      const { service, prisma, eventEmitter } = buildService();
      prisma.report.create.mockResolvedValue({ id: 'report-1' });

      await service.create('user-1', {
        accusedId: 'user-2',
        category: 'other',
        description: 'x',
      } as any);

      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        'report.escalated',
        expect.any(Object),
      );
    });

    it('flags a report as "unverified" when the reporter and accused have no shared booking', async () => {
      // Why: admins should know to double-check a claim that isn't backed by a real booking.
      const { service, prisma, eventEmitter } = buildService();
      prisma.booking.findUnique.mockResolvedValue({ clientId: 'someone-else', workerId: 'another-person' });
      prisma.report.create.mockResolvedValue({ id: 'report-1' });

      await service.create('user-1', {
        bookingId: 'booking-1',
        accusedId: 'user-2',
        category: 'other',
        description: 'x',
      } as any);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'report.unverified',
        expect.objectContaining({ reportId: 'report-1' }),
      );
    });

    it('does not flag as unverified when the reporter and accused really were both on the booking', async () => {
      const { service, prisma, eventEmitter } = buildService();
      prisma.booking.findUnique.mockResolvedValue({ clientId: 'user-1', workerId: 'user-2' });
      prisma.report.create.mockResolvedValue({ id: 'report-1' });

      await service.create('user-1', {
        bookingId: 'booking-1',
        accusedId: 'user-2',
        category: 'other',
        description: 'x',
      } as any);

      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        'report.unverified',
        expect.any(Object),
      );
    });
  });

  describe('findOne', () => {
    it('throws when the report does not exist', async () => {
      const { service, prisma } = buildService();
      prisma.report.findUnique.mockResolvedValue(null);

      await expect(service.findOne('ghost', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('refuses to show a report to anyone other than the person who filed it', async () => {
      // Why: reports are private between the reporter and admins.
      const { service, prisma } = buildService();
      prisma.report.findUnique.mockResolvedValue({ reporterId: 'someone-else' });

      await expect(service.findOne('report-1', 'user-1')).rejects.toThrow(ForbiddenException);
    });
  });
});
