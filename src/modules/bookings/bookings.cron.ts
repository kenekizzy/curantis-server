import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

@Injectable()
export class BookingsCron {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async autoCompleteOverdueBookings() {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);

    const overdue = await this.prisma.booking.findMany({
      where: { status: BookingStatus.IN_PROGRESS, scheduledEnd: { lt: twoHoursAgo } },
    });

    for (const booking of overdue) {
      const escrowReleaseAt = new Date(Date.now() + 24 * 3_600_000);

      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { status: BookingStatus.COMPLETED, actualEnd: new Date(), escrowReleaseAt },
      });

      await this.prisma.bookingLog.create({
        data: {
          bookingId: booking.id,
          eventType: 'AUTO_COMPLETED',
          actorId: undefined,
          metadata: { reason: 'Auto-completed 2 hours past scheduled end' },
        },
      });

      this.eventEmitter.emit('booking.completed', {
        bookingId: booking.id,
        workerId: booking.workerId,
        clientId: booking.clientId,
        workerAmountKobo: booking.workerAmountKobo,
      });
    }
  }
}
