import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, WorkerType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { CreateWorkerProfileDto } from './dto/create-worker-profile.dto.js';
import { CreateClientProfileDto } from './dto/create-client-profile.dto.js';
import { UpdateWorkerProfileDto } from './dto/update-worker-profile.dto.js';
import { UpdateClientProfileDto } from './dto/update-client-profile.dto.js';

@Injectable()
export class ProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertWorkerProfile(userId: string, dto: CreateWorkerProfileDto) {
    if (dto.workerType === WorkerType.HS && (!dto.institution || !dto.gradYear)) {
      throw new BadRequestException(
        'Students must provide institution and graduation year',
      );
    }

    const hourlyRateKobo = BigInt(Math.round(dto.hourlyRate * 100));

    const sharedFields = {
      fullName: dto.fullName,
      bio: dto.bio,
      workerType: dto.workerType,
      hourlyRateKobo,
      state: dto.state,
      lga: dto.lga,
      yearsExperience: dto.yearsExperience,
      languages: dto.languages ?? [],
      skills: dto.skills ?? [],
      institution: dto.institution,
      gradYear: dto.gradYear,
      fieldOfStudy: dto.fieldOfStudy,
    };

    return this.prisma.workerProfile.upsert({
      where: { userId },
      create: { userId, ...sharedFields },
      update: sharedFields,
    });
  }

  async upsertClientProfile(userId: string, dto: CreateClientProfileDto) {
    const sharedFields = {
      fullName: dto.fullName,
      avatarUrl: dto.avatarUrl,
      state: dto.state,
      lga: dto.lga,
      careRecipientName: dto.careRecipientName,
      careRecipientAge: dto.careRecipientAge,
      careRecipientRel: dto.careRecipientRel,
      careNeedsSummary: dto.careNeedsSummary,
      emergencyName: dto.emergencyName,
      emergencyPhone: dto.emergencyPhone,
    };

    return this.prisma.clientProfile.upsert({
      where: { userId },
      create: { userId, ...sharedFields },
      update: sharedFields,
    });
  }

  async patchWorkerProfile(userId: string, dto: UpdateWorkerProfileDto) {
    const data: Prisma.WorkerProfileUpdateInput = {};

    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.bio !== undefined) data.bio = dto.bio;
    if (dto.workerType !== undefined) data.workerType = dto.workerType;
    if (dto.hourlyRate !== undefined)
      data.hourlyRateKobo = BigInt(Math.round(dto.hourlyRate * 100));
    if (dto.state !== undefined) data.state = dto.state;
    if (dto.lga !== undefined) data.lga = dto.lga;
    if (dto.yearsExperience !== undefined) data.yearsExperience = dto.yearsExperience;
    if (dto.languages !== undefined) data.languages = dto.languages;
    if (dto.skills !== undefined) data.skills = dto.skills;
    if (dto.institution !== undefined) data.institution = dto.institution;
    if (dto.gradYear !== undefined) data.gradYear = dto.gradYear;
    if (dto.fieldOfStudy !== undefined) data.fieldOfStudy = dto.fieldOfStudy;

    return this.prisma.workerProfile.update({ where: { userId }, data });
  }

  async patchClientProfile(userId: string, dto: UpdateClientProfileDto) {
    const data: Prisma.ClientProfileUpdateInput = {};

    if (dto.fullName !== undefined) data.fullName = dto.fullName;
    if (dto.avatarUrl !== undefined) data.avatarUrl = dto.avatarUrl;
    if (dto.state !== undefined) data.state = dto.state;
    if (dto.lga !== undefined) data.lga = dto.lga;
    if (dto.careRecipientName !== undefined) data.careRecipientName = dto.careRecipientName;
    if (dto.careRecipientAge !== undefined) data.careRecipientAge = dto.careRecipientAge;
    if (dto.careRecipientRel !== undefined) data.careRecipientRel = dto.careRecipientRel;
    if (dto.careNeedsSummary !== undefined) data.careNeedsSummary = dto.careNeedsSummary;
    if (dto.emergencyName !== undefined) data.emergencyName = dto.emergencyName;
    if (dto.emergencyPhone !== undefined) data.emergencyPhone = dto.emergencyPhone;

    return this.prisma.clientProfile.update({ where: { userId }, data });
  }

  async getOwnProfile(userId: string, role: string) {
    if (role === 'CLIENT') {
      return this.prisma.user.findUnique({
        where: { id: userId },
        include: { clientProfile: true },
      });
    }
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: { workerProfile: true },
    });
  }

  async getPublicWorkerProfile(userId: string) {
    const profile = await this.prisma.workerProfile.findUnique({
      where: { userId },
      select: {
        id: true,
        fullName: true,
        avatarUrl: true,
        bio: true,
        workerType: true,
        yearsExperience: true,
        hourlyRateKobo: true,
        state: true,
        lga: true,
        languages: true,
        skills: true,
        verificationStatus: true,
        avgRating: true,
        reviewCount: true,
        isAvailable: true,
        // institution, gradYear, fieldOfStudy intentionally excluded
      },
    });
    if (!profile) throw new NotFoundException('Worker profile not found');
    return profile;
  }
}
