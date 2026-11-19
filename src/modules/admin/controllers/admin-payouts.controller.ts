import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IsOptional, IsString } from 'class-validator';
import { Role, BookingStatus, PaymentStatus } from '@prisma/client';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { AdminRoles } from '../../../common/decorators/admin-role.decorator.js';
import { AdminRolesGuard } from '../../../common/guards/admin-roles.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../../../common/types/jwt-payload.type.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { AdminLoggerService } from '../services/admin-logger.service.js';

export class HoldPayoutDto {
  @IsString()
  reason!: string;
}

export class ReleasePayoutDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@UseGuards(AdminRolesGuard)
@Controller('admin/payouts')
export class AdminPayoutsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminLogger: AdminLoggerService,
    @InjectQueue('payouts') private readonly payoutsQueue: Queue,
  ) {}

  @AdminRoles('SUPER_ADMIN', 'FINANCE_OFFICER')
  @Get()
  async listPayouts() {
    const bookings = await this.prisma.booking.findMany({
      where: {
        status: { in: [BookingStatus.COMPLETED, BookingStatus.IN_PROGRESS] },
      },
      include: {
        worker: {
          include: {
            workerProfile: {
              select: { fullName: true },
            },
          },
        },
        payment: {
          select: { status: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    const now = new Date();
    const items = bookings.map((b) => {
      let status: 'SCHEDULED' | 'FAILED' | 'RELEASED' = 'SCHEDULED';
      if (b.payment?.status === PaymentStatus.FAILED) {
        status = 'FAILED';
      } else if (b.escrowReleaseAt && b.escrowReleaseAt <= now) {
        status = 'RELEASED';
      }

      return {
        bookingId: b.id,
        workerName: b.worker.workerProfile?.fullName || b.worker.email,
        amountKobo: b.workerAmountKobo.toString(),
        releaseAt: b.escrowReleaseAt ? b.escrowReleaseAt.toISOString() : b.updatedAt.toISOString(),
        status,
      };
    });

    return items;
  }

  @AdminRoles('SUPER_ADMIN', 'FINANCE_OFFICER')
  @Patch(':id/release')
  async releasePayout(
    @Param('id') bookingId: string,
    @Body() dto: ReleasePayoutDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { workerId: true, workerAmountKobo: true },
    });
    if (!booking) throw new BadRequestException('Booking not found');

    await this.payoutsQueue.add('release-escrow', {
      bookingId,
      workerId: booking.workerId,
      amountKobo: booking.workerAmountKobo.toString(),
    });

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { escrowReleaseAt: new Date() },
    });

    await this.adminLogger.log(
      admin.sub,
      'PAYOUT_MANUAL_RELEASE',
      'booking',
      bookingId,
      dto?.reason ?? 'Manual release',
    );
    return { queued: true };
  }

  @AdminRoles('SUPER_ADMIN', 'FINANCE_OFFICER')
  @Patch(':id/hold')
  async holdPayout(
    @Param('id') bookingId: string,
    @Body() dto: HoldPayoutDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
    });
    if (!booking) throw new BadRequestException('Booking not found');

    // Postpone escrow release date into the far future to place on administrative hold
    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 365);

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { escrowReleaseAt: farFuture },
    });

    await this.adminLogger.log(admin.sub, 'PAYOUT_HELD', 'booking', bookingId, dto.reason);
    return { held: true };
  }
}
