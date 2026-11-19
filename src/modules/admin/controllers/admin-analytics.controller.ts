import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { AdminRoles } from '../../../common/decorators/admin-role.decorator.js';
import { AdminRolesGuard } from '../../../common/guards/admin-roles.guard.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@UseGuards(AdminRolesGuard)
@Controller('admin')
export class AdminAnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('analytics')
  async getAnalytics() {
    const [userCount, bookingCount, workerCount, revenue] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.booking.count(),
      this.prisma.user.count({ where: { role: { in: ['HW', 'HS'] } } }),
      this.prisma.payment.aggregate({
        where: { status: 'SUCCESSFUL' },
        _sum: { amountKobo: true },
      }),
    ]);

    return {
      users: userCount,
      workers: workerCount,
      bookings: bookingCount,
      revenueKobo: revenue._sum.amountKobo ?? BigInt(0),
    };
  }

  @AdminRoles('SUPER_ADMIN')
  @Get('logs')
  getLogs(
    @Query('adminId') adminId?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.prisma.adminLog.findMany({
      where: adminId ? { adminId } : {},
      orderBy: { createdAt: 'desc' },
      take: 50,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
  }
}
