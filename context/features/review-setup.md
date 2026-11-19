# Phase 7 — Reviews, Reports & Notifications

> ReviewsModule · ReportsModule · NotificationsModule (pure event listener)
> **Estimated time:** ~2 days

---

## 📋 Table of Contents

- [Goal](#-goal)
- [Step 1 — ReviewsModule](#-step-1--reviewsmodule)
- [Step 2 — ReportsModule](#-step-2--reportsmodule)
- [Step 3 — NotificationsModule](#-step-3--notificationsmodule)
- [API Reference](#-api-reference)
- [Verification Checklist](#-verification-checklist)
- [Common Pitfalls](#-common-pitfalls)

---

## 🎯 Goal

Reviews build trust, reports surface safety concerns, and notifications keep every party informed without requiring them to poll the API. `NotificationsModule` is unusual in this codebase — it has almost no controllers of its own. It exists almost entirely as a reactive listener to events emitted by every other module.

---

## 🗄️ Schema

```prisma
// prisma/schema.prisma

enum ReviewStatus {
  PUBLISHED
  FLAGGED
  REMOVED
}

model Review {
  id            String       @id @default(cuid())
  bookingId     String       @unique
  clientId      String
  workerId      String
  rating        Int
  body          String?      @db.VarChar(500)
  status        ReviewStatus @default(PUBLISHED)
  removedReason String?      @db.Text
  editedAt      DateTime?
  lockedAt      DateTime?
  createdAt     DateTime     @default(now())
  updatedAt     DateTime     @updatedAt

  @@map("reviews")
}

model Report {
  id          String   @id @default(cuid())
  bookingId   String?
  reporterId  String
  accusedId   String
  category    String
  description String   @db.Text
  imageUrls   String[] @default([])
  status      String   @default("OPEN")
  outcome     String?  @db.Text
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@map("reports")
}

model Notification {
  id        String   @id @default(cuid())
  userId    String
  type      String
  title     String
  body      String
  isRead    Boolean  @default(false)
  metadata  Json?
  createdAt DateTime @default(now())

  @@index([userId, isRead])
  @@map("notifications")
}
```

```bash
npx prisma migrate dev --name add_reviews_reports_notifications
```

---

## ⭐ Step 1 — ReviewsModule

### DTO

```typescript
// src/modules/reviews/dto/create-review.dto.ts
import { IsString, IsInt, Min, Max, IsOptional, MaxLength } from 'class-validator';

export class CreateReviewDto {
  @IsString()
  bookingId: string;

  @IsInt() @Min(1) @Max(5)
  rating: number;

  @IsOptional() @IsString() @MaxLength(500)
  body?: string;
}
```

### Service — submission, rating recalculation, edit window

```typescript
// src/modules/reviews/reviews.service.ts
import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  async create(clientId: string, dto: CreateReviewDto) {
    const booking = await this.prisma.booking.findUnique({ where: { id: dto.bookingId } });
    if (!booking || booking.clientId !== clientId) throw new ForbiddenException();
    if (booking.status !== 'COMPLETED') {
      throw new BadRequestException('Reviews can only be left after a completed booking');
    }

    const existing = await this.prisma.review.findUnique({ where: { bookingId: dto.bookingId } });
    if (existing) throw new BadRequestException('You have already reviewed this booking');

    const review = await this.prisma.review.create({
      data: {
        bookingId: dto.bookingId,
        clientId,
        workerId: booking.workerId,
        rating: dto.rating,
        body: dto.body,
      },
    });

    await this.recalculateWorkerRating(booking.workerId);
    return review;
  }

  async update(reviewId: string, clientId: string, dto: Partial<CreateReviewDto>) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review || review.clientId !== clientId) throw new ForbiddenException();

    const editWindowExpired = Date.now() - review.createdAt.getTime() > 48 * 3600_000;
    if (editWindowExpired) throw new BadRequestException('The 48-hour edit window has passed');

    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { rating: dto.rating, body: dto.body, editedAt: new Date() },
    });

    await this.recalculateWorkerRating(review.workerId);
    return updated;
  }

  private async recalculateWorkerRating(workerId: string) {
    const result = await this.prisma.review.aggregate({
      where: { workerId, status: 'PUBLISHED' },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await this.prisma.workerProfile.update({
      where: { userId: workerId },
      data: {
        avgRating: result._avg.rating ?? 0,
        reviewCount: result._count.rating,
      },
    });
  }

  async flag(reviewId: string, reporterId: string) {
    return this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'FLAGGED' },
    });
  }
}
```

### Lock reviews after 48 hours (cron)

```typescript
// src/modules/reviews/reviews.cron.ts
import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class ReviewsCron {
  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async lockExpiredReviews() {
    const cutoff = new Date(Date.now() - 48 * 3600_000);
    await this.prisma.review.updateMany({
      where: { createdAt: { lt: cutoff }, lockedAt: null },
      data: { lockedAt: new Date() },
    });
  }
}
```

> ⚠️ **Recalculate the worker's `avgRating` on every review create or update, never just on create.** If a client edits their rating within the 48-hour window, the worker's average must reflect the edit — a stale average undermines the entire trust mechanism the rating system exists to provide.

> ⚠️ **One review per booking is enforced by the `@unique` constraint on `bookingId`, not just application logic.** Relying solely on an application-level check creates a race condition window; the database constraint is the actual guarantee.

---

## 🚨 Step 2 — ReportsModule

```typescript
// src/modules/reports/dto/create-report.dto.ts
import { IsString, IsOptional, IsArray, MaxLength, IsIn } from 'class-validator';

const REPORT_CATEGORIES = ['safety_concern', 'misconduct', 'no_show', 'quality_issue', 'fraud', 'other'];

export class CreateReportDto {
  @IsOptional() @IsString()
  bookingId?: string;

  @IsString()
  accusedId: string;

  @IsIn(REPORT_CATEGORIES)
  category: string;

  @IsString() @MaxLength(1000)
  description: string;

  @IsOptional() @IsArray()
  imageUrls?: string[];
}
```

```typescript
// src/modules/reports/reports.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateReportDto } from './dto/create-report.dto';

const SAFEGUARDING_CATEGORIES = ['safety_concern', 'misconduct'];

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService, private eventEmitter: EventEmitter2) {}

  async create(reporterId: string, dto: CreateReportDto) {
    if (dto.imageUrls && dto.imageUrls.length > 3) {
      throw new BadRequestException('Maximum of 3 images per report');
    }

    // Verify the reporter actually has a relationship with the accused via a real booking
    let verified = false;
    if (dto.bookingId) {
      const booking = await this.prisma.booking.findUnique({ where: { id: dto.bookingId } });
      verified = !!booking && [booking.clientId, booking.workerId].includes(reporterId)
        && [booking.clientId, booking.workerId].includes(dto.accusedId);
    }

    const report = await this.prisma.report.create({
      data: { reporterId, ...dto, status: 'OPEN' },
    });

    if (SAFEGUARDING_CATEGORIES.includes(dto.category)) {
      this.eventEmitter.emit('report.escalated', { reportId: report.id, category: dto.category });
    }

    if (!verified && dto.bookingId) {
      this.eventEmitter.emit('report.unverified', { reportId: report.id });
    }

    return { referenceNumber: report.id, status: 'OPEN' };
  }
}
```

> ⚠️ **Safeguarding categories auto-escalate regardless of verification status.** A report alleging misconduct or a safety concern must reach a Super Admin immediately — don't let the "unverified relationship" check delay or soften this escalation. Verification failure is logged as a separate signal, not a reason to deprioritize a safeguarding claim.

---

## 🔔 Step 3 — NotificationsModule

`NotificationsModule` has two HTTP endpoints and otherwise exists as a constellation of `@OnEvent` listeners reacting to everything happening elsewhere in the system.

```bash
pnpm add resend
```

```env
RESEND_API_KEY=re_...
TERMII_API_KEY=
TERMII_SENDER_ID=CareGiverNG
```

### The two HTTP endpoints

```typescript
// src/modules/notifications/notifications.controller.ts
import { Controller, Get, Patch, Param } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  @Get()
  async list(@CurrentUser() user) {
    return this.notificationsService.listForUser(user.sub);
  }

  @Patch(':id/read')
  async markRead(@CurrentUser() user, @Param('id') id: string) {
    return this.notificationsService.markRead(user.sub, id);
  }
}
```

### Event listeners — the real substance of this module

```typescript
// src/modules/notifications/notifications.listener.ts
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';

@Injectable()
export class NotificationsListener {
  constructor(@InjectQueue('notifications') private notifQueue: Queue) {}

  @OnEvent('booking.created')
  async onBookingCreated({ workerId, bookingId }: any) {
    await this.notifQueue.add('send-notification', {
      userId: workerId, type: 'BOOKING_REQUEST', bookingId,
    });
  }

  @OnEvent('booking.accepted')
  async onBookingAccepted({ clientId, bookingId }: any) {
    await this.notifQueue.add('send-notification', {
      userId: clientId, type: 'BOOKING_ACCEPTED', bookingId,
    });
  }

  @OnEvent('booking.completed')
  async onBookingCompleted({ clientId, workerId, bookingId }: any) {
    await this.notifQueue.addBulk([
      { name: 'send-notification', data: { userId: clientId, type: 'BOOKING_COMPLETE', bookingId } },
      { name: 'send-notification', data: { userId: workerId, type: 'BOOKING_COMPLETE', bookingId } },
    ]);
  }

  @OnEvent('payment.successful')
  async onPaymentSuccessful({ bookingId }: any) {
    await this.notifQueue.add('send-notification', {
      type: 'PAYMENT_CONFIRMED', bookingId,
    });
  }

  @OnEvent('verification.status_changed')
  async onVerificationStatusChanged({ userId, status }: any) {
    await this.notifQueue.add('send-notification', {
      userId, type: 'VERIFICATION_UPDATE', metadata: { status },
    });
  }

  @OnEvent('report.escalated')
  async onReportEscalated({ reportId }: any) {
    await this.notifQueue.add('alert-super-admin', { reportId, urgent: true });
  }
}
```

### Processor — actually sends email/SMS

```typescript
// src/modules/notifications/processors/notifications.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Resend } from 'resend';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

const resend = new Resend(process.env.RESEND_API_KEY);

@Processor('notifications')
export class NotificationsProcessor extends WorkerHost {
  constructor(private prisma: PrismaService) {
    super();
  }

  async process(job: Job) {
    if (job.name === 'send-notification') {
      const { userId, type, bookingId, metadata } = job.data;

      await this.prisma.notification.create({
        data: { userId, type, title: this.titleFor(type), body: this.bodyFor(type, bookingId), metadata },
      });

      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user?.email) {
        await resend.emails.send({
          from: 'CareGiverNG <notifications@caregiverng.com>',
          to: user.email,
          subject: this.titleFor(type),
          html: `<p>${this.bodyFor(type, bookingId)}</p>`,
        });
      }
    }

    if (job.name === 'send-otp') {
      const { identifier, otp } = job.data;
      if (!identifier.includes('@')) {
        await this.sendSms(identifier, `Your CareGiverNG verification code is ${otp}`);
      }
    }
  }

  private async sendSms(phone: string, message: string) {
    await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: process.env.TERMII_API_KEY,
        to: phone,
        from: process.env.TERMII_SENDER_ID,
        sms: message,
        type: 'plain',
        channel: 'generic',
      }),
    });
  }

  private titleFor(type: string): string {
    const titles: Record<string, string> = {
      BOOKING_REQUEST: 'New booking request',
      BOOKING_ACCEPTED: 'Your booking was accepted',
      BOOKING_COMPLETE: 'Booking completed',
      PAYMENT_CONFIRMED: 'Payment confirmed',
      VERIFICATION_UPDATE: 'Verification status updated',
    };
    return titles[type] ?? 'CareGiverNG update';
  }

  private bodyFor(type: string, bookingId?: string): string {
    return `Reference: ${bookingId ?? 'N/A'}`;
  }
}
```

> ⚠️ **Email and SMS sending must never block the HTTP response that triggered them.** This is the entire reason `NotificationsModule` is queue-driven rather than calling Resend or Termii directly from a controller — a slow or failing third-party email API should never make a booking creation request hang.

---

## 📡 API Reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/reviews` | JWT (client) | Submit a review for a completed booking |
| PATCH | `/reviews/:id` | JWT (client) | Edit own review (within 48hr window) |
| POST | `/reviews/:id/flag` | JWT (any) | Flag a review for moderation |
| POST | `/reports` | JWT (any) | Submit an incident report |
| GET | `/reports/me` | JWT (any) | List own submitted reports |
| GET | `/reports/:id` | JWT (any) | Get status of own report |
| GET | `/notifications` | JWT (any) | List own notifications |
| PATCH | `/notifications/:id/read` | JWT (any) | Mark a notification as read |

---

## ✅ Verification Checklist

- [ ] POST `/reviews` on a non-COMPLETED booking returns 400
- [ ] POST `/reviews` a second time on the same booking returns 400 (unique constraint)
- [ ] PATCH `/reviews/:id` after 48 hours returns 400
- [ ] Worker's `avgRating` and `reviewCount` update immediately after a review is created or edited
- [ ] Cron job sets `lockedAt` on reviews older than 48 hours (test with an adjusted interval in dev)
- [ ] POST `/reports` with a safeguarding category emits `report.escalated`
- [ ] POST `/reports` with more than 3 image URLs returns 400
- [ ] GET `/notifications` returns only the authenticated user's own notifications
- [ ] A booking lifecycle event (e.g. `booking.accepted`) results in a new row in the `notifications` table and a queued email job
- [ ] Killing the Resend API key temporarily doesn't prevent the booking-related HTTP request from completing successfully

---

## ⚠️ Common Pitfalls

> **Pitfall: recalculating rating only on create, not on edit.**
> If a client lowers their rating during the edit window and the average isn't recalculated, the worker's displayed rating becomes stale and misleading — and stays that way until their next review comes in.

> **Pitfall: putting business logic in the NotificationsProcessor.**
> The processor's job is to format and send — it should never make decisions about whether a notification *should* be sent. That decision belongs in the listener that emits the queue job. Keep the processor dumb and the listener smart.

> **Pitfall: forgetting `report.unverified` doesn't mean "ignore".**
> An unverified report (no real booking relationship between reporter and accused) is still a real report. It changes how confidently the admin can act on it, but it must still appear in the queue — never silently drop reports that fail the verification heuristic.

---

## ➡️ Next Phase

Move to **Phase 8 — Admin Module + Socket.io**, the final phase. Every event emitted across Phases 5, 6, and this phase becomes visible and actionable through the admin surfaces built next.

---

*Last updated: June 2026*