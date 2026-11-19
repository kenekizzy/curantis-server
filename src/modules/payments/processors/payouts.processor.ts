import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import axios from 'axios';
import { BookingStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';

@Processor('payouts')
export class PayoutsProcessor extends WorkerHost {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== 'release-escrow') return;

    const { bookingId, workerId, amountKobo } = job.data as {
      bookingId: string;
      workerId: string;
      amountKobo: string;
    };

    // Re-check status inside processor — dispute can be raised during the 24hr window
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (booking?.status === BookingStatus.DISPUTED) return;

    const bankAccount = await this.prisma.bankAccount.findFirst({
      where: { workerId, isDefault: true, verified: true },
    });
    if (!bankAccount) {
      // BullMQ will retry per queue config
      throw new Error(`No verified default bank account for worker ${workerId} — payout held`);
    }

    // Note: In production, bankAccount.id should be replaced with a Paystack transfer
    // recipient_code (RCP_...) created via POST /transferrecipient during addBankAccount.
    await axios.post(
      'https://api.paystack.co/transfer',
      {
        source: 'balance',
        amount: Number(amountKobo),
        recipient: bankAccount.id,
        reason: `Payout for booking ${bookingId}`,
      },
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY!}` } },
    );
  }
}
