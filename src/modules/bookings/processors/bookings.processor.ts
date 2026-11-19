import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';

@Processor('bookings')
export class BookingsProcessor extends WorkerHost {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'auto-decline') {
      const { bookingId } = job.data as { bookingId: string };
      const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });

      if (booking?.status === BookingStatus.PENDING) {
        await this.prisma.booking.update({
          where: { id: bookingId },
          data: {
            status: BookingStatus.CANCELLED,
            cancelledBy: 'SYSTEM',
            cancellationReason: 'No response within 2 hours',
          },
        });
        this.eventEmitter.emit('booking.auto_declined', {
          bookingId,
          clientId: booking.clientId,
        });
      }
    }
  }
}
