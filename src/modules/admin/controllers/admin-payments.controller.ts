import { Controller, Get, Post, Patch, Param, Body, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IsString, IsOptional } from 'class-validator';
import { Role, PaymentStatus } from '@prisma/client';
import type { Response } from 'express';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { AdminRoles } from '../../../common/decorators/admin-role.decorator.js';
import { AdminRolesGuard } from '../../../common/guards/admin-roles.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../../../common/types/jwt-payload.type.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { PaymentsService } from '../../payments/payments.service.js';
import { AdminLoggerService } from '../services/admin-logger.service.js';

class IssueRefundDto {
  @IsString()
  amountKobo!: string;

  @IsString()
  reason!: string;
}

class ReleasePayoutDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@UseGuards(AdminRolesGuard)
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly adminLogger: AdminLoggerService,
    @InjectQueue('payouts') private readonly payoutsQueue: Queue,
  ) {}

  @AdminRoles('SUPER_ADMIN', 'FINANCE_OFFICER')
  @Get()
  async list(@Query('status') status?: string) {
    const payments = await this.prisma.payment.findMany({
      where: status ? { status: status as PaymentStatus } : {},
      include: {
        booking: {
          select: {
            platformFeeKobo: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    let gmvKobo = 0n;
    let commissionKobo = 0n;

    for (const p of payments) {
      if (p.status === PaymentStatus.SUCCESSFUL) {
        gmvKobo += p.amountKobo;
        if (p.booking?.platformFeeKobo) {
          commissionKobo += p.booking.platformFeeKobo;
        }
      }
    }

    const items = payments.map((p) => ({
      id: p.id,
      bookingId: p.bookingId,
      amountKobo: p.amountKobo.toString(),
      gateway: p.gateway,
      gatewayRef: p.gatewayRef,
      status: p.status,
      paidAt: p.paidAt ? p.paidAt.toISOString() : null,
    }));

    return {
      items,
      summary: {
        gmvKobo: gmvKobo.toString(),
        commissionKobo: commissionKobo.toString(),
      },
    };
  }

  @AdminRoles('SUPER_ADMIN', 'FINANCE_OFFICER')
  @Get('export')
  async exportCsv(@Res() res: Response) {
    const payments = await this.prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    const header = 'id,bookingId,clientId,amountKobo,gateway,gatewayRef,status,paidAt,createdAt\n';
    const rows = payments
      .map((p) =>
        [
          p.id,
          p.bookingId,
          p.clientId,
          p.amountKobo.toString(),
          p.gateway,
          p.gatewayRef,
          p.status,
          p.paidAt ? p.paidAt.toISOString() : '',
          p.createdAt.toISOString(),
        ].join(','),
      )
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="transactions.csv"');
    res.send(header + rows);
  }

  @AdminRoles('SUPER_ADMIN', 'FINANCE_OFFICER')
  @Post(':id/refund')
  async refund(
    @Param('id') paymentId: string,
    @Body() dto: IssueRefundDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    const result = await this.paymentsService.issueRefund(
      paymentId,
      BigInt(dto.amountKobo),
      dto.reason,
    );
    await this.adminLogger.log(admin.sub, 'REFUND_ISSUED', 'payment', paymentId, dto.reason);
    return result;
  }

  @AdminRoles('SUPER_ADMIN', 'FINANCE_OFFICER')
  @Get('payouts')
  listPayouts() {
    const now = new Date();
    return this.prisma.booking.findMany({
      where: { status: 'COMPLETED', escrowReleaseAt: { lte: now } },
      select: {
        id: true,
        workerId: true,
        workerAmountKobo: true,
        escrowReleaseAt: true,
        actualEnd: true,
      },
      orderBy: { escrowReleaseAt: 'asc' },
      take: 100,
    });
  }

  @AdminRoles('SUPER_ADMIN', 'FINANCE_OFFICER')
  @Patch('payouts/:id/release')
  async releasePayout(
    @Param('id') bookingId: string,
    @Body() dto: ReleasePayoutDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { workerId: true, workerAmountKobo: true },
    });
    if (!booking) return { error: 'Booking not found' };

    await this.payoutsQueue.add('release-escrow', {
      bookingId,
      workerId: booking.workerId,
      amountKobo: booking.workerAmountKobo.toString(),
    });
    await this.adminLogger.log(admin.sub, 'PAYOUT_MANUAL_RELEASE', 'booking', bookingId, dto.reason);
    return { queued: true };
  }
}
