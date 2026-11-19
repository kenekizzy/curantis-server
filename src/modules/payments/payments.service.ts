import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingStatus, Prisma } from '@prisma/client';
import axios from 'axios';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';

interface PaystackInitData {
  authorization_url: string;
}

interface PaystackInitResponse {
  data: PaystackInitData;
}

interface PaystackResolveData {
  account_name: string;
}

interface PaystackResolveResponse {
  data: PaystackResolveData;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── Initiate ─────────────────────────────────────────────────

  async initiate(bookingId: string, clientId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { client: true },
    });
    if (!booking || booking.clientId !== clientId) {
      throw new BadRequestException('Booking not found');
    }
    if (booking.status !== BookingStatus.ACCEPTED) {
      throw new BadRequestException('Booking must be accepted before payment');
    }

    const existing = await this.prisma.payment.findUnique({ where: { bookingId } });
    if (existing?.status === 'SUCCESSFUL') {
      throw new BadRequestException('This booking has already been paid for');
    }

    const reference = `cgn_${bookingId}_${Date.now()}`;

    const response = await axios.post<PaystackInitResponse>(
      'https://api.paystack.co/transaction/initialize',
      {
        email: booking.client.email,
        amount: Number(booking.totalAmountKobo),
        reference,
        currency: 'NGN',
        metadata: { bookingId },
      },
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY!}` } },
    );

    await this.prisma.payment.upsert({
      where: { bookingId },
      create: {
        bookingId,
        clientId,
        amountKobo: booking.totalAmountKobo,
        gateway: 'PAYSTACK',
        gatewayRef: reference,
        status: 'PENDING',
      },
      update: { gatewayRef: reference, status: 'PENDING' },
    });

    return {
      authorizationUrl: response.data.data.authorization_url,
      reference,
      amountKobo: booking.totalAmountKobo.toString(),
      clientEmail: booking.client.email,
    };
  }

  // ── Webhook success handler (idempotent) ─────────────────────

  async handlePaymentSuccess(
    reference: string,
    gatewayData: Record<string, unknown>,
  ): Promise<void> {
    const payment = await this.prisma.payment.findUnique({
      where: { gatewayRef: reference },
    });
    if (!payment) return; // Unknown reference — log and ignore, never throw
    if (payment.status === 'SUCCESSFUL') return; // Idempotent: duplicate delivery

    await this.prisma.$transaction([
      this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCESSFUL',
          paidAt: new Date(),
          metadata: gatewayData as unknown as Prisma.InputJsonValue,
        },
      }),
      this.prisma.booking.update({
        where: { id: payment.bookingId },
        data: { status: BookingStatus.CONFIRMED },
      }),
    ]);

    this.eventEmitter.emit('payment.successful', {
      bookingId: payment.bookingId,
      paymentId: payment.id,
    });
  }

  // ── Refund ───────────────────────────────────────────────────

  async issueRefund(paymentId: string, amountKobo: bigint, reason: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (amountKobo > payment.amountKobo) {
      throw new BadRequestException('Refund exceeds original payment amount');
    }

    const refund = await this.prisma.refund.create({
      data: { paymentId, amountKobo, reason, status: 'PENDING' },
    });

    try {
      await axios.post(
        'https://api.paystack.co/refund',
        { transaction: payment.gatewayRef, amount: Number(amountKobo) },
        { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY!}` } },
      );

      const newStatus = amountKobo === payment.amountKobo ? 'REFUNDED' : 'PARTIAL_REFUNDED';

      await this.prisma.$transaction([
        this.prisma.payment.update({ where: { id: paymentId }, data: { status: newStatus } }),
        this.prisma.refund.update({
          where: { id: refund.id },
          data: { status: 'COMPLETED', processedAt: new Date() },
        }),
      ]);
    } catch (err) {
      await this.prisma.refund.update({ where: { id: refund.id }, data: { status: 'FAILED' } });
      throw new BadRequestException('Refund could not be processed');
    }

    return refund;
  }

  // ── Bank accounts ─────────────────────────────────────────────

  async addBankAccount(workerId: string, bankCode: string, accountNumber: string) {
    const resolved = await axios.get<PaystackResolveResponse>(
      `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY!}` } },
    );

    const accountName = resolved.data.data.account_name;

    const existingCount = await this.prisma.bankAccount.count({ where: { workerId } });
    if (existingCount >= 2) {
      throw new BadRequestException('Maximum of 2 bank accounts allowed');
    }

    return this.prisma.bankAccount.create({
      data: {
        workerId,
        bankCode,
        accountNumber,
        accountName,
        verified: true,
        isDefault: existingCount === 0,
      },
    });
  }

  async listBankAccounts(workerId: string) {
    return this.prisma.bankAccount.findMany({
      where: { workerId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async setDefaultAccount(workerId: string, accountId: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: accountId, workerId },
    });
    if (!account) throw new NotFoundException('Bank account not found');

    await this.prisma.$transaction([
      this.prisma.bankAccount.updateMany({ where: { workerId }, data: { isDefault: false } }),
      this.prisma.bankAccount.update({ where: { id: accountId }, data: { isDefault: true } }),
    ]);

    return { success: true };
  }

  async deleteAccount(workerId: string, accountId: string) {
    const account = await this.prisma.bankAccount.findFirst({
      where: { id: accountId, workerId },
    });
    if (!account) throw new NotFoundException('Bank account not found');

    const pendingPayout = await this.prisma.booking.findFirst({
      where: { workerId, status: BookingStatus.COMPLETED, escrowReleaseAt: { gt: new Date() } },
    });
    if (pendingPayout) {
      throw new BadRequestException('Cannot remove account while a payout is pending');
    }

    return this.prisma.bankAccount.delete({ where: { id: accountId } });
  }

  // ── Earnings ──────────────────────────────────────────────────

  async getEarnings(workerId: string) {
    const now = new Date();

    const [totalResult, pendingResult, availableResult] = await Promise.all([
      this.prisma.booking.aggregate({
        where: { workerId, status: BookingStatus.COMPLETED },
        _sum: { workerAmountKobo: true },
      }),
      this.prisma.booking.aggregate({
        where: { workerId, status: BookingStatus.COMPLETED, escrowReleaseAt: { gt: now } },
        _sum: { workerAmountKobo: true },
      }),
      this.prisma.booking.aggregate({
        where: { workerId, status: BookingStatus.COMPLETED, escrowReleaseAt: { lte: now } },
        _sum: { workerAmountKobo: true },
      }),
    ]);

    return {
      totalKobo: totalResult._sum.workerAmountKobo ?? 0n,
      pendingEscrowKobo: pendingResult._sum.workerAmountKobo ?? 0n,
      availableKobo: availableResult._sum.workerAmountKobo ?? 0n,
    };
  }

  // ── Get payment ───────────────────────────────────────────────

  async getPayment(paymentId: string, userId: string, role: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { select: { workerId: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    if (
      role !== 'ADMIN' &&
      payment.clientId !== userId &&
      payment.booking.workerId !== userId
    ) {
      throw new ForbiddenException();
    }

    return payment;
  }
}
