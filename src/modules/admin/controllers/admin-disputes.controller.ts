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
import { IsIn, IsOptional, IsString } from 'class-validator';
import { Role, BookingStatus } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { AdminRoles } from '../../../common/decorators/admin-role.decorator.js';
import { AdminRolesGuard } from '../../../common/guards/admin-roles.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../../../common/types/jwt-payload.type.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { PaymentsService } from '../../payments/payments.service.js';
import { AdminLoggerService } from '../services/admin-logger.service.js';

export class ResolveDisputeDto {
  @IsIn(['refund_client', 'partial_refund', 'release_to_worker', 'escalate'])
  decision!: 'refund_client' | 'partial_refund' | 'release_to_worker' | 'escalate';

  @IsString()
  outcome!: string;

  @IsOptional()
  @IsString()
  refundAmountKobo?: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@UseGuards(AdminRolesGuard)
@Controller('admin/disputes')
export class AdminDisputesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly adminLogger: AdminLoggerService,
    @InjectQueue('payouts') private readonly payoutsQueue: Queue,
  ) {}

  @AdminRoles('SUPER_ADMIN', 'SUPPORT_AGENT')
  @Get()
  async list() {
    const disputedBookings = await this.prisma.booking.findMany({
      where: { status: BookingStatus.DISPUTED },
      include: {
        client: {
          include: {
            clientProfile: {
              select: { fullName: true },
            },
          },
        },
        worker: {
          include: {
            workerProfile: {
              select: { fullName: true },
            },
          },
        },
        reports: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });

    const items = disputedBookings.map((b) => {
      const clientReport = b.reports.find((r) => r.reporterId === b.clientId);
      const workerReport = b.reports.find((r) => r.reporterId === b.workerId);

      return {
        id: clientReport?.id || b.id,
        bookingId: b.id,
        clientName: b.client.clientProfile?.fullName || b.client.email,
        workerName: b.worker.workerProfile?.fullName || b.worker.email,
        amountKobo: b.totalAmountKobo.toString(),
        raisedAt: b.updatedAt.toISOString(),
        clientStatement: clientReport?.description || b.cancellationReason || null,
        workerStatement: workerReport?.description || null,
      };
    });

    return items;
  }

  @AdminRoles('SUPER_ADMIN', 'SUPPORT_AGENT')
  @Patch(':id/resolve')
  async resolve(
    @Param('id') bookingId: string,
    @Body() dto: ResolveDisputeDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { payment: true },
    });
    if (!booking || booking.status !== BookingStatus.DISPUTED) {
      throw new BadRequestException('No active dispute on this booking');
    }

    if (dto.decision === 'refund_client') {
      await this.paymentsService.issueRefund(
        booking.payment!.id,
        booking.totalAmountKobo,
        dto.outcome,
      );
    } else if (dto.decision === 'partial_refund' && dto.refundAmountKobo) {
      await this.paymentsService.issueRefund(
        booking.payment!.id,
        BigInt(dto.refundAmountKobo),
        dto.outcome,
      );
    } else if (dto.decision === 'release_to_worker') {
      await this.payoutsQueue.add('release-escrow', {
        bookingId,
        workerId: booking.workerId,
        amountKobo: booking.workerAmountKobo.toString(),
      });
    }

    const finalStatus =
      dto.decision === 'escalate' ? BookingStatus.DISPUTED : BookingStatus.COMPLETED;
    await this.prisma.booking.update({ where: { id: bookingId }, data: { status: finalStatus } });

    this.eventEmitter.emit('dispute.resolved', {
      bookingId,
      clientId: booking.clientId,
      workerId: booking.workerId,
      outcome: dto.outcome,
    });

    await this.adminLogger.log(admin.sub, 'DISPUTE_RESOLVED', 'booking', bookingId, dto.outcome);
    return { status: 'resolved', decision: dto.decision };
  }
}
