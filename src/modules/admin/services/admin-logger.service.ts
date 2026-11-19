import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';

type LogMetadata = Parameters<PrismaService['adminLog']['create']>[0]['data']['metadata'];

@Injectable()
export class AdminLoggerService {
  constructor(private readonly prisma: PrismaService) {}

  async log(
    adminId: string,
    action: string,
    targetType: string,
    targetId: string,
    reason?: string,
    metadata?: LogMetadata,
  ) {
    return this.prisma.adminLog.create({
      data: { adminId, action, targetType, targetId, reason, metadata },
    });
  }
}
