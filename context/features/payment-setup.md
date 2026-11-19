# Phase 6 — Payments (Paystack + Flutterwave + Escrow)

> Payment initiation · HMAC-verified webhooks · Escrow release · Refunds · Bank accounts
> **Estimated time:** ~3 days · Coordinate closely with Phase 5's events

---

## 📋 Table of Contents

- [Goal](#-goal)
- [Step 1 — Initiate Payment](#-step-1--initiate-payment)
- [Step 2 — Webhook Handlers](#-step-2--webhook-handlers)
- [Step 3 — Escrow Release](#-step-3--escrow-release)
- [Step 4 — Refunds](#-step-4--refunds)
- [Step 5 — Bank Account Management](#-step-5--bank-account-management)
- [API Reference](#-api-reference)
- [Verification Checklist](#-verification-checklist)
- [Common Pitfalls](#-common-pitfalls)

---

## 🎯 Goal

Money moves through three states: client pays → platform holds in escrow → worker is paid (minus commission), or refunded back to the client. Every step in this chain must be idempotent — webhooks can and will be delivered more than once by payment gateways, and your system must handle that without double-charging or double-crediting anyone.

---

## 🗄️ Schema

```prisma
// prisma/schema.prisma

enum PaymentGateway {
  PAYSTACK
  FLUTTERWAVE
}

enum PaymentStatus {
  PENDING
  SUCCESSFUL
  FAILED
  REFUNDED
  PARTIAL_REFUNDED
}

model Payment {
  id          String         @id @default(cuid())
  bookingId   String         @unique
  clientId    String
  amountKobo  BigInt
  currency    String         @default("NGN")
  gateway     PaymentGateway
  gatewayRef  String         @unique
  status      PaymentStatus  @default(PENDING)
  paidAt      DateTime?
  metadata    Json?
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt

  refunds Refund[]

  @@map("payments")
}

model Refund {
  id          String    @id @default(cuid())
  paymentId   String
  amountKobo  BigInt
  reason      String
  status      String    @default("PENDING")
  processedAt DateTime?
  createdAt   DateTime  @default(now())

  payment Payment @relation(fields: [paymentId], references: [id])

  @@map("refunds")
}

model BankAccount {
  id            String  @id @default(cuid())
  workerId      String
  bankCode      String
  accountNumber String
  accountName   String
  isDefault     Boolean @default(false)
  verified      Boolean @default(false)
  createdAt     DateTime @default(now())

  @@unique([workerId, accountNumber])
  @@map("bank_accounts")
}
```

```bash
npx prisma migrate dev --name add_payments
pnpm add axios
```

```env
PAYSTACK_SECRET_KEY=sk_test_...
PAYSTACK_WEBHOOK_SECRET=...
FLUTTERWAVE_SECRET_KEY=FLWSECK_TEST-...
FLUTTERWAVE_WEBHOOK_HASH=...
```

---

## 💳 Step 1 — Initiate Payment

```typescript
// src/modules/payments/payments.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  async initiate(bookingId: string, clientId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { client: true },
    });
    if (!booking || booking.clientId !== clientId) throw new BadRequestException('Booking not found');
    if (booking.status !== 'ACCEPTED') throw new BadRequestException('Booking must be accepted before payment');

    const existingPayment = await this.prisma.payment.findUnique({ where: { bookingId } });
    if (existingPayment?.status === 'SUCCESSFUL') {
      throw new BadRequestException('This booking has already been paid for');
    }

    const reference = `cgn_${bookingId}_${Date.now()}`;

    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      {
        email: booking.client.email,
        amount: Number(booking.totalAmountKobo), // Paystack expects kobo as a plain number
        reference,
        currency: 'NGN',
        metadata: { bookingId },
      },
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } },
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
    };
  }
}
```

> ⚠️ **Block re-payment on an already-successful booking.** Without this check, a confused client retrying a payment that already succeeded (e.g. after a slow page load) could initiate a second charge.

---

## 🪝 Step 2 — Webhook Handlers

This is the most security-critical code in the entire backend. Webhook verification must happen before any business logic runs.

### Raw body middleware — required for HMAC verification

```typescript
// src/main.ts — add before app.useGlobalPipes()
import * as bodyParser from 'body-parser';

app.use(
  '/api/v1/payments/webhooks',
  bodyParser.raw({ type: 'application/json' }),
);
```

> ⚠️ **HMAC signatures are computed over the raw, unparsed request body.** If NestJS's default JSON body parser runs first and reserializes the payload, the bytes will differ from what the gateway signed — even a single whitespace difference breaks the signature check. The raw body middleware must be registered for the webhook route specifically, before the global JSON parser applies.

### Paystack webhook controller

```typescript
// src/modules/payments/webhooks/paystack.webhook.ts
import { Controller, Post, Req, Headers, BadRequestException } from '@nestjs/common';
import { Request } from 'express';
import * as crypto from 'crypto';
import { Public } from '../../../common/decorators/public.decorator';
import { PaymentsService } from '../payments.service';

@Controller('payments/webhooks')
export class PaystackWebhookController {
  constructor(private paymentsService: PaymentsService) {}

  @Public()
  @Post('paystack')
  async handle(@Req() req: Request, @Headers('x-paystack-signature') signature: string) {
    const rawBody = req.body as Buffer;

    const hash = crypto
      .createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET!)
      .update(rawBody)
      .digest('hex');

    if (hash !== signature) throw new BadRequestException('Invalid webhook signature');

    const event = JSON.parse(rawBody.toString());

    if (event.event === 'charge.success') {
      await this.paymentsService.handlePaymentSuccess(event.data.reference, event.data);
    }

    return { received: true };
  }
}
```

### Service — idempotent success handling

```typescript
// payments.service.ts (continued)
import { EventEmitter2 } from '@nestjs/event-emitter';

async handlePaymentSuccess(reference: string, gatewayData: any) {
  const payment = await this.prisma.payment.findUnique({ where: { gatewayRef: reference } });
  if (!payment) return; // Unknown reference — log and ignore, don't throw

  // Idempotency: if already processed, this is a duplicate webhook delivery — no-op
  if (payment.status === 'SUCCESSFUL') return;

  await this.prisma.$transaction([
    this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'SUCCESSFUL', paidAt: new Date(), metadata: gatewayData },
    }),
    this.prisma.booking.update({
      where: { id: payment.bookingId },
      data: { status: 'CONFIRMED', paymentId: payment.id },
    }),
  ]);

  this.eventEmitter.emit('payment.successful', { bookingId: payment.bookingId, paymentId: payment.id });
}
```

> ⚠️ **Idempotency is mandatory, not optional.** Paystack and Flutterwave both retry webhook delivery if they don't receive a fast 200 response. Without the `status === 'SUCCESSFUL'` early return, a retried webhook would attempt to re-confirm an already-confirmed booking — usually harmless, but with payouts later in the chain, processing the same event twice could trigger a duplicate payout.

> ⚠️ **Always return 200 quickly, even on logical no-ops.** If you throw an exception for an "unknown reference" instead of silently returning, the gateway will interpret the non-200 response as a delivery failure and keep retrying indefinitely.

---

## 🏦 Step 3 — Escrow Release

```typescript
// src/modules/payments/payments.listener.ts
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';

@Injectable()
export class PaymentsListener {
  constructor(@InjectQueue('payouts') private payoutsQueue: Queue) {}

  @OnEvent('booking.completed')
  async scheduleEscrowRelease(payload: { bookingId: string; workerId: string; workerAmountKobo: bigint }) {
    await this.payoutsQueue.add(
      'release-escrow',
      { bookingId: payload.bookingId, workerId: payload.workerId, amountKobo: payload.workerAmountKobo.toString() },
      { delay: 24 * 3600_000, jobId: `escrow-release-${payload.bookingId}` },
    );
  }
}
```

### Payout processor

```typescript
// src/modules/payments/processors/payouts.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import axios from 'axios';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

@Processor('payouts')
export class PayoutsProcessor extends WorkerHost {
  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job) {
    if (job.name === 'release-escrow') {
      const { bookingId, workerId, amountKobo } = job.data;

      const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
      if (booking?.status === 'DISPUTED') return; // Dispute raised since scheduling — abort

      const bankAccount = await this.prisma.bankAccount.findFirst({
        where: { workerId, isDefault: true, verified: true },
      });
      if (!bankAccount) {
        throw new Error('No verified default bank account — payout held for manual action');
      }

      try {
        await axios.post(
          'https://api.paystack.co/transfer',
          {
            source: 'balance',
            amount: amountKobo,
            recipient: bankAccount.id, // assumes a Paystack transfer recipient was pre-created
            reason: `Payout for booking ${bookingId}`,
          },
          { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } },
        );
      } catch (err) {
        throw err; // BullMQ will retry per the queue's configured attempts
      }
    }
  }
}
```

### Queue retry configuration

```typescript
// src/infrastructure/queue/queue.module.ts
import { BullModule } from '@nestjs/bullmq';

BullModule.registerQueue({
  name: 'payouts',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'fixed', delay: 3600_000 }, // retry after 1 hour
  },
});
```

> ⚠️ **Re-check the booking status inside the processor, not just at scheduling time.** A dispute can be raised at any point during the 24-hour delay window. The job must verify the booking isn't `DISPUTED` immediately before executing the transfer — checking only when the job was scheduled is not enough.

---

## 💸 Step 4 — Refunds

```typescript
// payments.service.ts (continued)
async issueRefund(paymentId: string, amountKobo: bigint, reason: string, adminId: string) {
  const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new NotFoundException('Payment not found');
  if (amountKobo > payment.amountKobo) throw new BadRequestException('Refund exceeds original payment amount');

  const refund = await this.prisma.refund.create({
    data: { paymentId, amountKobo, reason, status: 'PENDING' },
  });

  try {
    await axios.post(
      'https://api.paystack.co/refund',
      { transaction: payment.gatewayRef, amount: Number(amountKobo) },
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } },
    );

    const newStatus = amountKobo === payment.amountKobo ? 'REFUNDED' : 'PARTIAL_REFUNDED';
    await this.prisma.$transaction([
      this.prisma.payment.update({ where: { id: paymentId }, data: { status: newStatus } }),
      this.prisma.refund.update({ where: { id: refund.id }, data: { status: 'COMPLETED', processedAt: new Date() } }),
    ]);
  } catch (err) {
    await this.prisma.refund.update({ where: { id: refund.id }, data: { status: 'FAILED' } });
    throw new BadRequestException('Refund could not be processed — queued for retry');
  }

  return refund;
}
```

> ⚠️ **A refund amount must never exceed the original payment.** This check protects against both honest mistakes (admin typo) and any client-side manipulation if the refund amount ever flows through a less-trusted path.

---

## 🏧 Step 5 — Bank Account Management

```typescript
// payments.service.ts (continued)
async addBankAccount(workerId: string, bankCode: string, accountNumber: string) {
  const resolved = await axios.get(
    `https://api.paystack.co/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
    { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } },
  );

  const accountName = resolved.data.data.account_name;

  const existingCount = await this.prisma.bankAccount.count({ where: { workerId } });
  if (existingCount >= 2) throw new BadRequestException('Maximum of 2 bank accounts allowed');

  return this.prisma.bankAccount.create({
    data: {
      workerId,
      bankCode,
      accountNumber,
      accountName,
      verified: true,
      isDefault: existingCount === 0, // first account is automatically default
    },
  });
}

async setDefaultAccount(workerId: string, accountId: string) {
  await this.prisma.$transaction([
    this.prisma.bankAccount.updateMany({ where: { workerId }, data: { isDefault: false } }),
    this.prisma.bankAccount.update({ where: { id: accountId }, data: { isDefault: true } }),
  ]);
}

async deleteAccount(workerId: string, accountId: string) {
  const pendingPayout = await this.prisma.booking.findFirst({
    where: { workerId, status: 'COMPLETED', escrowReleaseAt: { gt: new Date() } },
  });
  if (pendingPayout) throw new BadRequestException('Cannot remove account while a payout is pending');

  return this.prisma.bankAccount.delete({ where: { id: accountId } });
}
```

> ⚠️ **Resolve the account name via the gateway API before saving — never trust a manually-typed name.** This confirms the account number is real and surfaces a name mismatch (e.g. account belongs to someone other than the registered worker) before it becomes a payout problem.

---

## 📡 API Reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/payments/initiate` | JWT (client) | Initiate payment for a confirmed booking |
| POST | `/payments/webhooks/paystack` | Webhook sig | Paystack webhook handler (HMAC verified) |
| POST | `/payments/webhooks/flutterwave` | Webhook sig | Flutterwave webhook handler |
| GET | `/payments/:id` | JWT (any) | Get payment detail for own booking |
| GET | `/workers/me/earnings` | JWT (hw\|hs) | Worker earnings dashboard |
| GET | `/workers/me/bank-accounts` | JWT (hw\|hs) | List saved bank accounts |
| POST | `/workers/me/bank-accounts` | JWT (hw\|hs) | Add and verify a bank account |
| PATCH | `/workers/me/bank-accounts/:id/default` | JWT (hw\|hs) | Set default payout account |
| DELETE | `/workers/me/bank-accounts/:id` | JWT (hw\|hs) | Remove a bank account |

---

## ✅ Verification Checklist

- [ ] POST `/payments/initiate` on an already-paid booking returns 400
- [ ] Sending an unsigned or incorrectly-signed webhook payload returns 400 and changes nothing in the database
- [ ] Sending the same valid webhook payload twice only updates the booking once (idempotency)
- [ ] A successful webhook moves booking status from ACCEPTED to CONFIRMED
- [ ] `booking.completed` event correctly schedules a `release-escrow` job with a 24-hour delay (check BullMQ dashboard)
- [ ] A dispute raised during the 24-hour escrow window causes the payout processor to abort (test by manually triggering the job early in dev)
- [ ] Refund amount greater than the original payment returns 400
- [ ] Adding a bank account resolves and stores the correct `accountName` from Paystack
- [ ] The first bank account added is automatically set as default
- [ ] Deleting a bank account with a pending payout returns 400

---

## ⚠️ Common Pitfalls

> **Pitfall: JSON body parser running before the raw body middleware.**
> Order matters in `main.ts`. The raw body middleware for `/payments/webhooks` must be registered before any global `app.use(express.json())` equivalent, or NestJS's default body parsing will have already consumed and reserialized the stream by the time your raw middleware runs.

> **Pitfall: testing webhooks without simulating real gateway behavior.**
> Always test webhook idempotency by sending the exact same payload twice via Postman, not just once. A single successful test doesn't prove your idempotency check works — it proves the happy path works.

> **Pitfall: forgetting to cancel the escrow job on dispute.**
> Phase 5 raises the dispute and the booking status changes to DISPUTED, but the BullMQ job scheduled in this phase doesn't automatically know that. The payout processor must explicitly re-check the booking status before transferring funds — don't assume a status change alone halts a scheduled job.

> **Pitfall: amount type mismatches between kobo and Naira.**
> Paystack's API expects amounts in kobo as a plain JavaScript number, while your database stores them as `BigInt`. Convert with `Number(bigIntValue)` when calling the gateway API, but never use `Number()` for any value you intend to store or compare in the database — precision loss on large numbers is a real risk.

---

## ➡️ Next Phase

Move to **Phase 7 — Reviews, Reports & Notifications**. Reviews can only be submitted after a booking reaches COMPLETED status — the exact state this phase's payment confirmation flow puts a booking into.

---