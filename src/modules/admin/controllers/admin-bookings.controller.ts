import {
  Controller, Get, Patch, Param, Body, Query, BadRequestException, UseGuards,
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

class CancelBookingDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

class ResolveDisputeDto {
  @IsIn(['refund_client', 'partial_refund', 'release_to_worker', 'escalate'])
  decision!: string;

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
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly eventEmitter: EventEmitter2,
    private readonly adminLogger: AdminLoggerService,
    @InjectQueue('payouts') private readonly payoutsQueue: Queue,
  ) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('clientId') clientId?: string,
    @Query('workerId') workerId?: string,
  ) {
    return this.prisma.booking.findMany({
      where: {
        ...(status ? { status: status as BookingStatus } : {}),
        ...(clientId ? { clientId } : {}),
        ...(workerId ? { workerId } : {}),
      },
      include: { payment: { select: { status: true, amountKobo: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @AdminRoles('SUPER_ADMIN', 'SUPPORT_AGENT')
  @Patch(':id/cancel')
  async cancelBooking(
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) throw new BadRequestException('Booking not found');
    if (booking.status === BookingStatus.COMPLETED || booking.status === BookingStatus.CANCELLED) {
      throw new BadRequestException('Cannot cancel a terminal booking');
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data: { status: BookingStatus.CANCELLED, cancelledBy: admin.sub, cancellationReason: dto.reason },
    });
    await this.adminLogger.log(admin.sub, 'BOOKING_CANCELLED', 'booking', id, dto.reason);
    return updated;
  }

  @AdminRoles('SUPER_ADMIN', 'SUPPORT_AGENT')
  @Patch('disputes/:id/resolve')
  async resolveDispute(
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
      await this.paymentsService.issueRefund(booking.payment!.id, booking.totalAmountKobo, dto.outcome);
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

    const finalStatus = dto.decision === 'escalate' ? BookingStatus.DISPUTED : BookingStatus.COMPLETED;
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
