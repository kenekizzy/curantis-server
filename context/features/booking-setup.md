# Phase 5 — Bookings (The Core Transaction)

> Full booking lifecycle · EventEmitter2 · BullMQ delayed jobs · Audit logging
> **Estimated time:** ~3 days · The most complex module in the system

---

## 📋 Table of Contents

- [Goal](#-goal)
- [Step 1 — Create Booking](#-step-1--create-booking)
- [Step 2 — The 2-Hour Response Window](#-step-2--the-2-hour-response-window)
- [Step 3 — Accept / Decline](#-step-3--accept--decline)
- [Step 4 — Start / Complete Lifecycle](#-step-4--start--complete-lifecycle)
- [Step 5 — Cancel & Audit Log](#-step-5--cancel--audit-log)
- [Step 6 — Dispute](#-step-6--dispute)
- [API Reference](#-api-reference)
- [Verification Checklist](#-verification-checklist)
- [Common Pitfalls](#-common-pitfalls)

---

## 🎯 Goal

Build the entire booking state machine in one pass. Do not ship a booking flow that can get stuck in an intermediate state with no way out — every transition needs a corresponding timeout, cancellation path, or admin override. This is the module where solo developers are most tempted to cut corners; don't.

```
PENDING → ACCEPTED → CONFIRMED → IN_PROGRESS → COMPLETED
   │           │                                    │
   └─ auto-decline (2hr)              CANCELLED      └─ DISPUTED
                                    (any actor, any stage)
```

---

## 🗄️ Schema

```prisma
// prisma/schema.prisma

enum BookingStatus {
  PENDING
  ACCEPTED
  CONFIRMED
  IN_PROGRESS
  COMPLETED
  CANCELLED
  DISPUTED
}

model Booking {
  id                  String        @id @default(cuid())
  clientId            String
  workerId            String
  categoryId          String
  status              BookingStatus @default(PENDING)
  careAddress         String        @db.Text
  careRequirements    String?       @db.Text
  scheduledStart      DateTime
  scheduledEnd        DateTime
  actualStart         DateTime?
  actualEnd           DateTime?
  durationHours       Decimal       @db.Decimal(5, 2)
  hourlyRateKobo      BigInt
  totalAmountKobo     BigInt
  platformFeeKobo     BigInt
  workerAmountKobo    BigInt
  paymentId           String?       @unique
  cancelledBy         String?
  cancellationReason  String?       @db.Text
  escrowReleaseAt     DateTime?
  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt

  client   User            @relation("ClientBookings", fields: [clientId], references: [id])
  worker   User            @relation("WorkerBookings", fields: [workerId], references: [id])
  category ServiceCategory @relation(fields: [categoryId], references: [id])
  logs     BookingLog[]

  @@index([clientId, workerId, status, scheduledStart])
  @@map("bookings")
}

model BookingLog {
  id        String   @id @default(cuid())
  bookingId String
  eventType String
  actorId   String?
  metadata  Json?
  createdAt DateTime @default(now())

  booking Booking @relation(fields: [bookingId], references: [id], onDelete: Cascade)

  @@map("booking_logs")
}

model ServiceCategory {
  id           String  @id @default(cuid())
  name         String  @unique
  description  String?
  isRestricted Boolean @default(false) // true = HW only, blocked for HS

  bookings Booking[]

  @@map("service_categories")
}
```

```bash
npx prisma migrate dev --name add_bookings
```

---

## 📥 Step 1 — Create Booking

```bash
pnpm add @nestjs/bullmq @nestjs/event-emitter
```

### DTO

```typescript
// src/modules/bookings/dto/create-booking.dto.ts
import { IsString, IsDateString, IsNumber, Min, IsOptional } from 'class-validator';

export class CreateBookingDto {
  @IsString()
  workerId: string;

  @IsString()
  categoryId: string;

  @IsDateString()
  scheduledStart: string;

  @IsNumber() @Min(1)
  durationHours: number;

  @IsString()
  careAddress: string;

  @IsOptional() @IsString()
  careRequirements?: string;
}
```

### Service — with race-condition-safe slot checking

```typescript
// src/modules/bookings/bookings.service.ts
import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { CreateBookingDto } from './dto/create-booking.dto';

@Injectable()
export class BookingsService {
  constructor(
    private prisma: PrismaService,
    private eventEmitter: EventEmitter2,
    @InjectQueue('bookings') private bookingsQueue: Queue,
  ) {}

  async create(clientId: string, dto: CreateBookingDto) {
    const worker = await this.prisma.workerProfile.findUnique({
      where: { userId: dto.workerId },
      include: { user: true },
    });
    if (!worker || worker.verificationStatus !== 'VERIFIED') {
      throw new BadRequestException('This caregiver is not currently available for booking');
    }

    const category = await this.prisma.serviceCategory.findUnique({ where: { id: dto.categoryId } });
    if (!category) throw new BadRequestException('Invalid service category');

    if (category.isRestricted && worker.workerType === 'HS') {
      throw new ForbiddenException('This service category requires a licensed Healthcare Worker');
    }

    const scheduledStart = new Date(dto.scheduledStart);
    const scheduledEnd = new Date(scheduledStart.getTime() + dto.durationHours * 3600_000);

    // Transaction with row lock to prevent double-booking race conditions
    const booking = await this.prisma.$transaction(async (tx) => {
      const conflict = await tx.booking.findFirst({
        where: {
          workerId: dto.workerId,
          status: { in: ['PENDING', 'ACCEPTED', 'CONFIRMED', 'IN_PROGRESS'] },
          OR: [
            { scheduledStart: { lt: scheduledEnd }, scheduledEnd: { gt: scheduledStart } },
          ],
        },
      });
      if (conflict) throw new BadRequestException('This time slot is no longer available');

      const totalAmountKobo = BigInt(Math.round(Number(worker.hourlyRateKobo) * dto.durationHours));
      const platformFeeKobo = totalAmountKobo / 10n; // 10%
      const workerAmountKobo = totalAmountKobo - platformFeeKobo;

      return tx.booking.create({
        data: {
          clientId,
          workerId: dto.workerId,
          categoryId: dto.categoryId,
          careAddress: dto.careAddress,
          careRequirements: dto.careRequirements,
          scheduledStart,
          scheduledEnd,
          durationHours: dto.durationHours,
          hourlyRateKobo: worker.hourlyRateKobo,
          totalAmountKobo,
          platformFeeKobo,
          workerAmountKobo,
          status: 'PENDING',
        },
      });
    });

    await this.logEvent(booking.id, 'CREATED', clientId);

    // 2-hour auto-decline window
    await this.bookingsQueue.add(
      'auto-decline',
      { bookingId: booking.id },
      { delay: 2 * 3600_000, jobId: `auto-decline-${booking.id}` },
    );

    this.eventEmitter.emit('booking.created', { bookingId: booking.id, workerId: dto.workerId, clientId });

    return booking;
  }

  private async logEvent(bookingId: string, eventType: string, actorId?: string, metadata?: any) {
    return this.prisma.bookingLog.create({
      data: { bookingId, eventType, actorId, metadata },
    });
  }
}
```

> ⚠️ **Calculate every monetary value server-side, inside the transaction.** Never accept `totalAmountKobo` from the client. The rate is read from the worker's current profile at booking time and snapshotted onto the booking row — if the worker changes their rate later, already-created bookings are unaffected.

> ⚠️ **The conflict check and the booking creation must be in the same transaction.** Without `$transaction`, two clients booking the same slot simultaneously could both pass the conflict check before either has written their row — a classic race condition. Wrapping both operations in a transaction with Postgres's default isolation level prevents this.

---

## ⏱️ Step 2 — The 2-Hour Response Window

```typescript
// src/modules/bookings/processors/bookings.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Processor('bookings')
export class BookingsProcessor extends WorkerHost {
  constructor(private prisma: PrismaService, private eventEmitter: EventEmitter2) {
    super();
  }

  async process(job: Job) {
    if (job.name === 'auto-decline') {
      const { bookingId } = job.data;
      const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });

      if (booking?.status === 'PENDING') {
        await this.prisma.booking.update({
          where: { id: bookingId },
          data: { status: 'CANCELLED', cancelledBy: 'SYSTEM', cancellationReason: 'No response within 2 hours' },
        });
        this.eventEmitter.emit('booking.auto_declined', { bookingId, clientId: booking.clientId });
      }
    }
  }
}
```

> ⚠️ **Check the booking's current status before acting on the delayed job.** If the worker already accepted or declined before the 2-hour timer fired, the job must be a no-op — never overwrite a status that's moved past PENDING.

---

## ✅ Step 3 — Accept / Decline

```typescript
// bookings.service.ts (continued)
async accept(bookingId: string, workerId: string, message?: string) {
  const booking = await this.getOwnedBooking(bookingId, workerId, 'worker');
  if (booking.status !== 'PENDING') throw new BadRequestException('Booking is no longer pending');

  await this.prisma.booking.update({ where: { id: bookingId }, data: { status: 'ACCEPTED' } });
  await this.cancelAutoDeclineJob(bookingId);
  await this.logEvent(bookingId, 'ACCEPTED', workerId, { message });

  this.eventEmitter.emit('booking.accepted', { bookingId, clientId: booking.clientId });
  return { status: 'ACCEPTED' };
}

async decline(bookingId: string, workerId: string, reason?: string) {
  const booking = await this.getOwnedBooking(bookingId, workerId, 'worker');
  if (booking.status !== 'PENDING') throw new BadRequestException('Booking is no longer pending');

  await this.prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'CANCELLED', cancelledBy: workerId, cancellationReason: reason },
  });
  await this.cancelAutoDeclineJob(bookingId);
  await this.logEvent(bookingId, 'DECLINED', workerId, { reason });

  this.eventEmitter.emit('booking.declined', { bookingId, clientId: booking.clientId });
  return { status: 'CANCELLED' };
}

private async cancelAutoDeclineJob(bookingId: string) {
  const job = await this.bookingsQueue.getJob(`auto-decline-${bookingId}`);
  if (job) await job.remove();
}

private async getOwnedBooking(bookingId: string, userId: string, role: 'client' | 'worker') {
  const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new NotFoundException('Booking not found');
  if (role === 'worker' && booking.workerId !== userId) throw new ForbiddenException();
  if (role === 'client' && booking.clientId !== userId) throw new ForbiddenException();
  return booking;
}
```

---

## ▶️ Step 4 — Start / Complete Lifecycle

```typescript
// bookings.service.ts (continued)
async start(bookingId: string, workerId: string) {
  const booking = await this.getOwnedBooking(bookingId, workerId, 'worker');
  if (booking.status !== 'CONFIRMED') throw new BadRequestException('Booking must be confirmed before starting');

  await this.prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'IN_PROGRESS', actualStart: new Date() },
  });
  await this.logEvent(bookingId, 'STARTED', workerId);

  this.eventEmitter.emit('booking.started', { bookingId, clientId: booking.clientId });
  return { status: 'IN_PROGRESS' };
}

async complete(bookingId: string, workerId: string) {
  const booking = await this.getOwnedBooking(bookingId, workerId, 'worker');
  if (booking.status !== 'IN_PROGRESS') throw new BadRequestException('Booking must be in progress to complete');

  const escrowReleaseAt = new Date(Date.now() + 24 * 3600_000);

  await this.prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'COMPLETED', actualEnd: new Date(), escrowReleaseAt },
  });
  await this.logEvent(bookingId, 'COMPLETED', workerId);

  // PaymentsModule listens for this and schedules the escrow release job
  this.eventEmitter.emit('booking.completed', {
    bookingId,
    workerId,
    clientId: booking.clientId,
    workerAmountKobo: booking.workerAmountKobo,
  });

  return { status: 'COMPLETED' };
}
```

### Auto-complete cron job

```typescript
// src/modules/bookings/bookings.cron.ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class BookingsCron {
  constructor(private prisma: PrismaService, private eventEmitter: EventEmitter2) {}

  @Cron(CronExpression.EVERY_HOUR)
  async autoCompleteOverdueBookings() {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);

    const overdue = await this.prisma.booking.findMany({
      where: { status: 'IN_PROGRESS', scheduledEnd: { lt: twoHoursAgo } },
    });

    for (const booking of overdue) {
      const escrowReleaseAt = new Date(Date.now() + 24 * 3600_000);
      await this.prisma.booking.update({
        where: { id: booking.id },
        data: { status: 'COMPLETED', actualEnd: new Date(), escrowReleaseAt },
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
```

```bash
pnpm add @nestjs/schedule
```

> ⚠️ **The auto-complete window is 2 hours past `scheduledEnd`, not `actualStart`.** This protects workers who genuinely forget to tap "Complete" after a long shift, while still surfacing bookings that are stuck for review if something is actually wrong.

---

## ❌ Step 5 — Cancel & Audit Log

```typescript
// bookings.service.ts (continued)
async cancel(bookingId: string, actorId: string, actorRole: string, reason: string) {
  const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new NotFoundException('Booking not found');
  if (['COMPLETED', 'CANCELLED'].includes(booking.status)) {
    throw new BadRequestException('This booking cannot be cancelled');
  }

  const cancelledBy = actorRole === 'ADMIN' ? 'ADMIN' : actorId;

  await this.prisma.booking.update({
    where: { id: bookingId },
    data: { status: 'CANCELLED', cancelledBy, cancellationReason: reason },
  });
  await this.logEvent(bookingId, 'CANCELLED', actorId, { reason, actorRole });
  await this.cancelAutoDeclineJob(bookingId);

  this.eventEmitter.emit('booking.cancelled', {
    bookingId,
    clientId: booking.clientId,
    workerId: booking.workerId,
    cancelledBy: actorRole,
  });

  return { status: 'CANCELLED' };
}

async getLogs(bookingId: string) {
  return this.prisma.bookingLog.findMany({
    where: { bookingId },
    orderBy: { createdAt: 'asc' },
  });
}
```

> ⚠️ **`booking_logs` is append-only.** Never update or delete a log row — it exists specifically to provide an immutable record for dispute resolution. If you find yourself wanting to "correct" a log entry, add a new entry instead.

---

## ⚖️ Step 6 — Dispute

```typescript
// bookings.service.ts (continued)
async raiseDispute(bookingId: string, actorId: string, description: string) {
  const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new NotFoundException('Booking not found');
  if (![booking.clientId, booking.workerId].includes(actorId)) throw new ForbiddenException();

  await this.prisma.booking.update({ where: { id: bookingId }, data: { status: 'DISPUTED' } });
  await this.logEvent(bookingId, 'DISPUTE_RAISED', actorId, { description });

  // Pause any pending escrow release job
  await this.bookingsQueue.removeJobScheduler(`escrow-release-${bookingId}`);

  this.eventEmitter.emit('booking.disputed', {
    bookingId,
    clientId: booking.clientId,
    workerId: booking.workerId,
    raisedBy: actorId,
  });

  return { status: 'DISPUTED' };
}
```

> ⚠️ **Raising a dispute must pause the escrow release job, not just change the status.** If `PaymentsModule` already queued the 24-hour payout job in Phase 6 and the dispute fires before it executes, the job needs to be cancellable — design the job ID convention (`escrow-release-{bookingId}`) with this in mind from the start.

---

## 📡 API Reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/bookings` | JWT (client) | Create a booking request |
| GET | `/bookings` | JWT (any) | List own bookings (role-filtered) |
| GET | `/bookings/:id` | JWT (any) | Get single booking detail |
| PATCH | `/bookings/:id/accept` | JWT (hw\|hs) | Worker accepts a booking request |
| PATCH | `/bookings/:id/decline` | JWT (hw\|hs) | Worker declines a booking request |
| PATCH | `/bookings/:id/cancel` | JWT (any) | Cancel a booking |
| PATCH | `/bookings/:id/start` | JWT (hw\|hs) | Mark booking as started |
| PATCH | `/bookings/:id/complete` | JWT (hw\|hs) | Mark booking as completed |
| POST | `/bookings/:id/dispute` | JWT (any) | Raise a dispute on a booking |
| GET | `/bookings/:id/logs` | JWT (any) | Booking audit trail |

---

## ✅ Verification Checklist

- [ ] POST `/bookings` with an unverified worker's ID returns 400
- [ ] POST `/bookings` for a restricted category with an HS worker returns 403
- [ ] POST `/bookings` for an already-booked slot returns 400 (test with two near-simultaneous requests)
- [ ] Booking auto-declines after the 2-hour BullMQ delay if left PENDING (test with a shortened delay in dev)
- [ ] Accepting a booking cancels the pending `auto-decline` job (verify in BullMQ dashboard)
- [ ] `start` fails on a booking that isn't CONFIRMED
- [ ] `complete` sets `escrowReleaseAt` to exactly 24 hours from now
- [ ] Auto-complete cron picks up bookings 2+ hours past `scheduledEnd` still IN_PROGRESS
- [ ] `cancel` is blocked on COMPLETED or already-CANCELLED bookings
- [ ] Every status transition appends a row to `booking_logs` — confirm in Neon after a full lifecycle test
- [ ] Raising a dispute changes status to DISPUTED and removes the scheduled escrow job

---

## ⚠️ Common Pitfalls

> **Pitfall: trusting client-calculated totals.**
> If `totalAmountKobo` is ever accepted as a request body field instead of calculated server-side from the worker's current rate, a malicious client could submit an artificially low total. Recalculate from the source of truth every time.

> **Pitfall: race conditions without a transaction.**
> The conflict check (`findFirst`) and the booking insert (`create`) must be inside the same `$transaction` block. Splitting them across two separate database calls reopens the double-booking race condition this phase is specifically built to prevent.

> **Pitfall: forgetting to remove the BullMQ job on accept/decline.**
> If you don't call `job.remove()` when a worker accepts or declines within the window, the auto-decline job still fires 2 hours later and checks the booking status — which is harmless because of the status guard, but it's wasted work and clutters your BullMQ dashboard. Clean it up explicitly.

> **Pitfall: emitting events before the database write is confirmed.**
> Always emit the domain event (`booking.completed`, etc.) after the Prisma write succeeds, never before. If the write fails and rolls back but the event already fired, downstream listeners (payment scheduling, notifications) will act on a booking state that doesn't actually exist.

---

## ➡️ Next Phase

Move to **Phase 6 — Payments**. The `booking.completed` event emitted here is the trigger that `PaymentsModule` listens for to schedule the escrow release — build them with this contract in mind.
