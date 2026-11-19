import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class PaymentsListener {
  constructor(@InjectQueue('payouts') private readonly payoutsQueue: Queue) {}

  @OnEvent('booking.completed')
  async scheduleEscrowRelease(payload: {
    bookingId: string;
    workerId: string;
    workerAmountKobo: bigint;
  }): Promise<void> {
    await this.payoutsQueue.add(
      'release-escrow',
      {
        bookingId: payload.bookingId,
        workerId: payload.workerId,
        amountKobo: payload.workerAmountKobo.toString(),
      },
      { delay: 24 * 3_600_000, jobId: `escrow-release-${payload.bookingId}` },
    );
  }

  @OnEvent('booking.disputed')
  async cancelEscrowRelease(payload: { bookingId: string }): Promise<void> {
    const job = await this.payoutsQueue.getJob(`escrow-release-${payload.bookingId}`);
    if (job) await job.remove();
  }
}
