import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';

const DECISION_MAP: Record<string, VerificationStatus> = {
  approve: VerificationStatus.VERIFIED,
  reject: VerificationStatus.REJECTED,
  request_docs: VerificationStatus.PENDING,
};

@Injectable()
export class AdminVerificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async getQueue(status: string = 'PENDING') {
    return this.prisma.verification.findMany({
      where: { status: status as VerificationStatus },
      orderBy: { createdAt: 'asc' },
    });
  }

  async review(id: string, decision: string, note: string | undefined, adminId: string) {
    const verification = await this.prisma.verification.findUnique({ where: { id } });
    if (!verification) throw new NotFoundException('Verification not found');

    const newStatus = DECISION_MAP[decision] ?? VerificationStatus.PENDING;

    await this.prisma.verification.update({
      where: { id },
      data: { status: newStatus, adminNote: note, reviewedBy: adminId, reviewedAt: new Date() },
    });

    if (decision === 'approve') {
      await this.prisma.workerProfile.update({
        where: { userId: verification.userId },
        data: { verificationStatus: VerificationStatus.VERIFIED },
      });
    }

    this.eventEmitter.emit('verification.status_changed', {
      userId: verification.userId,
      status: newStatus,
    });

    return { status: newStatus };
  }
}
