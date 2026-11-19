import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VerificationStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { SearchWorkersDto } from './dto/search-workers.dto.js';

const PUBLIC_PROFILE_SELECT = {
  id: true,
  userId: true,
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
  // institution, gradYear, fieldOfStudy excluded from public view
} as const;

@Injectable()
export class WorkersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async search(dto: SearchWorkersDto) {
    const limit = dto.limit ?? 20;
    const cacheKey = `search:${JSON.stringify({ ...dto, limit })}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as unknown;

    const where: Prisma.WorkerProfileWhereInput = {
      verificationStatus: VerificationStatus.VERIFIED,
      isAvailable: true,
    };

    if (dto.q) {
      where.OR = [
        { fullName: { contains: dto.q, mode: 'insensitive' } },
        { bio: { contains: dto.q, mode: 'insensitive' } },
      ];
    }
    if (dto.state) where.state = dto.state;
    if (dto.lga) where.lga = dto.lga;
    if (dto.workerType) where.workerType = dto.workerType;
    if (dto.minRating !== undefined) where.avgRating = { gte: dto.minRating };
    if (dto.minRateKobo !== undefined || dto.maxRateKobo !== undefined) {
      where.hourlyRateKobo = {
        ...(dto.minRateKobo !== undefined && { gte: BigInt(dto.minRateKobo) }),
        ...(dto.maxRateKobo !== undefined && { lte: BigInt(dto.maxRateKobo) }),
      };
    }
    if (dto.languages?.length) where.languages = { hasSome: dto.languages };

    const results = await this.prisma.workerProfile.findMany({
      where,
      select: PUBLIC_PROFILE_SELECT,
      orderBy: this.buildOrderBy(dto.sort),
      take: limit,
      ...(dto.cursor && { cursor: { id: dto.cursor }, skip: 1 }),
    });

    const response = {
      items: results,
      meta: {
        nextCursor: results.at(-1)?.id ?? null,
        hasMore: results.length === limit,
        next_cursor: results.at(-1)?.id ?? null,
        has_more: results.length === limit,
      },
    };

    const serialized = JSON.stringify(response, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    await this.redis.setex(cacheKey, 60, serialized);

    return response;
  }

  async getPublicProfile(userId: string) {
    const profile = await this.prisma.workerProfile.findUnique({
      where: { userId },
      select: PUBLIC_PROFILE_SELECT,
    });
    if (!profile) throw new NotFoundException('Worker profile not found');
    return profile;
  }

  async getWorkerAvailability(userId: string, startDate?: string, endDate?: string) {
    const profile = await this.prisma.workerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Worker profile not found');

    const [slots, blocks] = await Promise.all([
      this.prisma.availabilitySlot.findMany({
        where: { workerId: profile.id },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      }),
      this.prisma.availabilityBlock.findMany({
        where: {
          workerId: profile.id,
          ...(startDate &&
            endDate && {
              AND: [
                { startDate: { lte: new Date(endDate) } },
                { endDate: { gte: new Date(startDate) } },
              ],
            }),
        },
        orderBy: { startDate: 'asc' },
      }),
    ]);

    return { slots, blocks };
  }

  private buildOrderBy(sort?: string): Prisma.WorkerProfileOrderByWithRelationInput {
    switch (sort) {
      case 'price_asc':
        return { hourlyRateKobo: 'asc' };
      case 'price_desc':
        return { hourlyRateKobo: 'desc' };
      case 'experience':
        return { yearsExperience: 'desc' };
      default:
        return { avgRating: 'desc' };
    }
  }
}
