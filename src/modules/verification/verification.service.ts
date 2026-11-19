import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { CredentialStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { SubmitIdentityDto } from './dto/submit-identity.dto.js';
import { SubmitCredentialDto } from './dto/submit-credential.dto.js';

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue('verification') private readonly verificationQueue: Queue,
  ) {}

  // ── Identity ─────────────────────────────────────────────────

  async submitIdentity(userId: string, dto: SubmitIdentityDto) {
    const existing = await this.prisma.verification.findFirst({
      where: { userId, status: 'PENDING' },
    });
    if (existing) {
      throw new BadRequestException('A verification submission is already pending review');
    }

    const verification = await this.prisma.verification.create({
      data: {
        userId,
        nin: dto.nin,
        idDocUrl: dto.idDocUrl,
        selfieUrl: dto.selfieUrl,
        status: 'PENDING',
      },
    });

    if (dto.nin) {
      await this.verificationQueue.add('nin-lookup', {
        verificationId: verification.id,
        nin: dto.nin,
      });
    }

    return verification;
  }

  async getStatus(userId: string) {
    return this.prisma.verification.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Credentials (HW only) ────────────────────────────────────

  async submitCredential(userId: string, dto: SubmitCredentialDto, role: string) {
    if (role !== 'HW') {
      throw new ForbiddenException('Only Healthcare Workers can submit professional credentials');
    }

    const profile = await this.prisma.workerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Worker profile not found');

    const credential = await this.prisma.credential.create({
      data: {
        workerId: profile.id,
        title: dto.title,
        issuingBody: dto.issuingBody,
        licenceNumber: dto.licenceNumber,
        documentUrl: dto.documentUrl,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        status: CredentialStatus.PENDING,
      },
    });

    if (credential.expiresAt) {
      const sixtyDaysBefore = new Date(credential.expiresAt);
      sixtyDaysBefore.setDate(sixtyDaysBefore.getDate() - 60);
      const thirtyDaysBefore = new Date(credential.expiresAt);
      thirtyDaysBefore.setDate(thirtyDaysBefore.getDate() - 30);

      await this.verificationQueue.add(
        'credential-expiry-reminder',
        { credentialId: credential.id, daysOut: 60 },
        { delay: Math.max(0, sixtyDaysBefore.getTime() - Date.now()) },
      );
      await this.verificationQueue.add(
        'credential-expiry-reminder',
        { credentialId: credential.id, daysOut: 30 },
        { delay: Math.max(0, thirtyDaysBefore.getTime() - Date.now()) },
      );
    }

    return credential;
  }

  async listCredentials(userId: string) {
    const profile = await this.prisma.workerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) return [];

    return this.prisma.credential.findMany({
      where: { workerId: profile.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteCredential(userId: string, credentialId: string) {
    const profile = await this.prisma.workerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Worker profile not found');

    const credential = await this.prisma.credential.findUnique({
      where: { id: credentialId },
    });
    if (!credential || credential.workerId !== profile.id) {
      throw new ForbiddenException('Cannot delete this credential');
    }
    if (credential.status !== CredentialStatus.PENDING) {
      throw new BadRequestException('Cannot delete a credential that has already been reviewed');
    }

    return this.prisma.credential.delete({ where: { id: credentialId } });
  }
}
