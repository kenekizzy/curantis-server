import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

@Injectable()
export class ReviewsCron {
  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async lockExpiredReviews(): Promise<void> {
    const cutoff = new Date(Date.now() - 48 * 3_600_000);
    await this.prisma.review.updateMany({
      where: { createdAt: { lt: cutoff }, lockedAt: null },
      data: { lockedAt: new Date() },
    });
  }
}
