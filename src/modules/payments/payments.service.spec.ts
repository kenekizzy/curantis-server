import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import axios from 'axios';
import { PaymentsService } from './payments.service.js';

// 💳 What is this file checking?
// This is the money department: starting a payment with Paystack,
// confirming it succeeded (via webhook), refunding, managing bank
// accounts, and reporting how much a worker has earned. Because real
// money is involved, the tests lean extra hard on:
//   - never double-charging or double-confirming the same payment
//   - never refunding more than was actually paid
//   - never letting a worker remove their bank account while a payout is
//     still on its way to it
// We fake Paystack itself (the `axios` calls) so tests never hit the
// real internet or move real money.

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('PaymentsService', () => {
  function buildService() {
    const prisma = {
      booking: { findUnique: jest.fn(), update: jest.fn(), aggregate: jest.fn(), findFirst: jest.fn() },
      payment: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
      refund: { create: jest.fn(), update: jest.fn() },
      bankAccount: {
        count: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn((ops: any) => Promise.all(ops)),
    } as any;
    const eventEmitter = { emit: jest.fn() } as any;
    return { service: new PaymentsService(prisma, eventEmitter), prisma, eventEmitter };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_fake';
  });

  describe('initiate', () => {
    const booking = {
      id: 'booking-1',
      clientId: 'client-1',
      status: BookingStatus.ACCEPTED,
      totalAmountKobo: 1_000_000n,
      client: { email: 'a@b.com' },
    };

    it('refuses when the booking does not belong to the caller', async () => {
      // Why: a client should never be able to pay for someone else's booking.
      const { service, prisma } = buildService();
      prisma.booking.findUnique.mockResolvedValue({ ...booking, clientId: 'someone-else' });

      await expect(service.initiate('booking-1', 'client-1')).rejects.toThrow(BadRequestException);
    });

    it('refuses to start payment before the worker has accepted the booking', async () => {
      // Why: paying for a booking nobody agreed to yet doesn't make sense.
      const { service, prisma } = buildService();
      prisma.booking.findUnique.mockResolvedValue({ ...booking, status: BookingStatus.PENDING });

      await expect(service.initiate('booking-1', 'client-1')).rejects.toThrow(BadRequestException);
    });

    it('refuses to charge again for a booking that has already been paid for', async () => {
      // Why: never double-charge a client.
      const { service, prisma } = buildService();
      prisma.booking.findUnique.mockResolvedValue(booking);
      prisma.payment.findUnique.mockResolvedValue({ status: 'SUCCESSFUL' });

      await expect(service.initiate('booking-1', 'client-1')).rejects.toThrow(BadRequestException);
    });

    it('starts a Paystack transaction for the exact kobo amount and saves it as PENDING', async () => {
      // Why: the everyday happy path — the amount sent to Paystack must
      // match the booking's total exactly (in kobo, never a rounded Naira float).
      const { service, prisma } = buildService();
      prisma.booking.findUnique.mockResolvedValue(booking);
      prisma.payment.findUnique.mockResolvedValue(null);
      mockedAxios.post.mockResolvedValue({
        data: { data: { authorization_url: 'https://paystack.com/pay/abc' } },
      });

      const result = await service.initiate('booking-1', 'client-1');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://api.paystack.co/transaction/initialize',
        expect.objectContaining({ amount: 1_000_000 }),
        expect.any(Object),
      );
      expect(prisma.payment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ create: expect.objectContaining({ status: 'PENDING' }) }),
      );
      expect(result.authorizationUrl).toBe('https://paystack.com/pay/abc');
    });
  });

  describe('handlePaymentSuccess', () => {
    it('silently ignores a webhook for a reference we do not recognise', async () => {
      // Why: never crash on a webhook replay/typo — just ignore unknown references.
      const { service, prisma } = buildService();
      prisma.payment.findUnique.mockResolvedValue(null);

      await service.handlePaymentSuccess('unknown-ref', {});

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('ignores a second webhook delivery for a payment already marked SUCCESSFUL', async () => {
      // Why: Paystack can send the same webhook more than once — we must
      // never confirm the same payment (and emit the event) twice.
      const { service, prisma, eventEmitter } = buildService();
      prisma.payment.findUnique.mockResolvedValue({ id: 'pay-1', status: 'SUCCESSFUL' });

      await service.handlePaymentSuccess('ref-1', {});

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('confirms the payment and moves the booking to CONFIRMED, then announces it', async () => {
      // Why: this is what actually unlocks chat and lets the worker start the job.
      const { service, prisma, eventEmitter } = buildService();
      prisma.payment.findUnique.mockResolvedValue({
        id: 'pay-1',
        status: 'PENDING',
        bookingId: 'booking-1',
      });

      await service.handlePaymentSuccess('ref-1', { some: 'data' });

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(eventEmitter.emit).toHaveBeenCalledWith('payment.successful', {
        bookingId: 'booking-1',
        paymentId: 'pay-1',
      });
    });
  });

  describe('issueRefund', () => {
    it('refuses to refund more than was actually paid', async () => {
      // Why: this would mean the platform hands out more money than it received.
      const { service, prisma } = buildService();
      prisma.payment.findUnique.mockResolvedValue({ id: 'pay-1', amountKobo: 500_000n });

      await expect(service.issueRefund('pay-1', 600_000n, 'client request')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('marks the refund FAILED and reports an error when Paystack rejects the refund call', async () => {
      // Why: if the money never actually moved, our own records must say so.
      const { service, prisma } = buildService();
      prisma.payment.findUnique.mockResolvedValue({
        id: 'pay-1',
        amountKobo: 500_000n,
        gatewayRef: 'ref-1',
      });
      prisma.refund.create.mockResolvedValue({ id: 'refund-1' });
      mockedAxios.post.mockRejectedValue(new Error('gateway down'));

      await expect(service.issueRefund('pay-1', 500_000n, 'client request')).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.refund.update).toHaveBeenCalledWith({
        where: { id: 'refund-1' },
        data: { status: 'FAILED' },
      });
    });

    it('marks a full refund as REFUNDED (not PARTIAL_REFUNDED) when the whole amount is returned', async () => {
      // Why: the payment's status should reflect exactly how much came back.
      const { service, prisma } = buildService();
      prisma.payment.findUnique.mockResolvedValue({
        id: 'pay-1',
        amountKobo: 500_000n,
        gatewayRef: 'ref-1',
      });
      prisma.refund.create.mockResolvedValue({ id: 'refund-1' });
      mockedAxios.post.mockResolvedValue({ data: {} });

      await service.issueRefund('pay-1', 500_000n, 'client request');

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: { status: 'REFUNDED' },
      });
    });

    it('marks a partial refund as PARTIAL_REFUNDED when only some of the payment is returned', async () => {
      // Why: a ₦2,000 refund on a ₦5,000 payment is a different situation
      // from a full refund, and the frontend needs to tell them apart.
      const { service, prisma } = buildService();
      prisma.payment.findUnique.mockResolvedValue({
        id: 'pay-1',
        amountKobo: 500_000n,
        gatewayRef: 'ref-1',
      });
      prisma.refund.create.mockResolvedValue({ id: 'refund-1' });
      mockedAxios.post.mockResolvedValue({ data: {} });

      await service.issueRefund('pay-1', 200_000n, 'partial goodwill refund');

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { id: 'pay-1' },
        data: { status: 'PARTIAL_REFUNDED' },
      });
    });
  });

  describe('addBankAccount', () => {
    it('refuses to add a third bank account (max 2 allowed)', async () => {
      // Why: keeps the worker's payout setup simple and easy to review.
      const { service, prisma } = buildService();
      mockedAxios.get.mockResolvedValue({ data: { data: { account_name: 'Amaka J.' } } });
      prisma.bankAccount.count.mockResolvedValue(2);

      await expect(service.addBankAccount('worker-1', '058', '0123456789')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('makes the very first bank account the default one automatically', async () => {
      // Why: a worker with one account obviously wants payouts to go there.
      const { service, prisma } = buildService();
      mockedAxios.get.mockResolvedValue({ data: { data: { account_name: 'Amaka J.' } } });
      prisma.bankAccount.count.mockResolvedValue(0);
      prisma.bankAccount.create.mockResolvedValue({ id: 'acct-1', isDefault: true });

      await service.addBankAccount('worker-1', '058', '0123456789');

      expect(prisma.bankAccount.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isDefault: true }) }),
      );
    });
  });

  describe('deleteAccount', () => {
    it('refuses to delete an account while a payout is still on its way to it', async () => {
      // Why: yanking the account out mid-payout could send the worker's money nowhere.
      const { service, prisma } = buildService();
      prisma.bankAccount.findFirst.mockResolvedValue({ id: 'acct-1' });
      prisma.booking.findFirst.mockResolvedValue({ id: 'booking-1' });

      await expect(service.deleteAccount('worker-1', 'acct-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deletes the account when there is nothing pending against it', async () => {
      const { service, prisma } = buildService();
      prisma.bankAccount.findFirst.mockResolvedValue({ id: 'acct-1' });
      prisma.booking.findFirst.mockResolvedValue(null);
      prisma.bankAccount.delete.mockResolvedValue({ id: 'acct-1' });

      await service.deleteAccount('worker-1', 'acct-1');

      expect(prisma.bankAccount.delete).toHaveBeenCalledWith({ where: { id: 'acct-1' } });
    });
  });

  describe('getEarnings', () => {
    it('reports total, pending-escrow, and available amounts as zero when there is no history yet', async () => {
      // Why: a brand new worker shouldn't see "undefined" — they should see ₦0.
      const { service, prisma } = buildService();
      prisma.booking.aggregate.mockResolvedValue({ _sum: { workerAmountKobo: null } });

      const result = await service.getEarnings('worker-1');

      expect(result).toEqual({ totalKobo: 0n, pendingEscrowKobo: 0n, availableKobo: 0n });
    });
  });

  describe('getPayment', () => {
    it('throws when the payment does not exist', async () => {
      const { service, prisma } = buildService();
      prisma.payment.findUnique.mockResolvedValue(null);

      await expect(service.getPayment('ghost', 'user-1', 'CLIENT')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses to show the payment to someone who is neither the client, the worker, nor an admin', async () => {
      const { service, prisma } = buildService();
      prisma.payment.findUnique.mockResolvedValue({
        clientId: 'client-1',
        booking: { workerId: 'worker-1' },
      });

      await expect(service.getPayment('pay-1', 'stranger', 'CLIENT')).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});
