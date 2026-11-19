# Phase 4 — Verification & Search

> VerificationModule (identity + credentials) · WorkersModule (search) · AvailabilityModule
> **Estimated time:** ~3 days

---

## 📋 Table of Contents

- [Goal](#-goal)
- [Step 1 — VerificationModule (Identity)](#-step-1--verificationmodule-identity)
- [Step 2 — VerificationModule (Credentials, HW only)](#-step-2--verificationmodule-credentials-hw-only)
- [Step 3 — WorkersModule (Search)](#-step-3--workersmodule-search)
- [Step 4 — AvailabilityModule](#-step-4--availabilitymodule)
- [API Reference](#-api-reference)
- [Verification Checklist](#-verification-checklist)
- [Common Pitfalls](#-common-pitfalls)

---

## 🎯 Goal

Workers and students cannot appear in search or receive bookings until verified. This phase builds the document submission flow, the credential management system, the Postgres full-text search that powers caregiver discovery, and the availability calendar that determines when a worker can be booked.

---

## 🪪 Step 1 — VerificationModule (Identity)

### Schema

```prisma
// prisma/schema.prisma

model Verification {
  id           String              @id @default(cuid())
  userId       String
  nin          String?
  idDocUrl     String
  selfieUrl    String
  status       VerificationStatus  @default(PENDING)
  adminNote    String?             @db.Text
  reviewedBy   String?
  reviewedAt   DateTime?
  createdAt    DateTime            @default(now())
  updatedAt    DateTime            @updatedAt

  @@index([status])
  @@map("verifications")
}

model Credential {
  id            String           @id @default(cuid())
  workerId      String
  title         String
  issuingBody   String
  licenceNumber String?
  documentUrl   String
  expiresAt     DateTime?        @db.Date
  status        CredentialStatus @default(PENDING)
  adminNote     String?          @db.Text
  createdAt     DateTime         @default(now())
  updatedAt     DateTime         @updatedAt

  workerProfile WorkerProfile @relation(fields: [workerId], references: [id], onDelete: Cascade)

  @@map("credentials")
}

enum CredentialStatus {
  PENDING
  VERIFIED
  REJECTED
  EXPIRED
}
```

```bash
npx prisma migrate dev --name add_verification
```

### DTO

```typescript
// src/modules/verification/dto/submit-identity.dto.ts
import { IsString, IsOptional, Length } from 'class-validator';

export class SubmitIdentityDto {
  @IsOptional() @IsString() @Length(11, 11)
  nin?: string;

  @IsString()
  idDocUrl: string; // S3 URL returned from the presigned upload step

  @IsString()
  selfieUrl: string;
}
```

### Service

```typescript
// src/modules/verification/verification.service.ts
import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { SubmitIdentityDto } from './dto/submit-identity.dto';

@Injectable()
export class VerificationService {
  constructor(
    private prisma: PrismaService,
    @InjectQueue('verification') private verificationQueue: Queue,
  ) {}

  async submitIdentity(userId: string, dto: SubmitIdentityDto) {
    const existing = await this.prisma.verification.findFirst({
      where: { userId, status: 'PENDING' },
    });
    if (existing) throw new BadRequestException('A verification is already pending review');

    const verification = await this.prisma.verification.create({
      data: { userId, ...dto, status: 'PENDING' },
    });

    if (dto.nin) {
      await this.verificationQueue.add('nin-lookup', { verificationId: verification.id, nin: dto.nin });
    }

    return verification;
  }

  async getStatus(userId: string) {
    return this.prisma.verification.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async submitCredential(workerId: string, dto: any, role: string) {
    if (role !== 'HW') {
      throw new ForbiddenException('Only Healthcare Workers can submit professional credentials');
    }

    const credential = await this.prisma.credential.create({
      data: { workerId, ...dto, status: 'PENDING' },
    });

    if (credential.expiresAt) {
      const sixtyDaysBefore = new Date(credential.expiresAt);
      sixtyDaysBefore.setDate(sixtyDaysBefore.getDate() - 60);
      const thirtyDaysBefore = new Date(credential.expiresAt);
      thirtyDaysBefore.setDate(thirtyDaysBefore.getDate() - 30);

      await this.verificationQueue.add(
        'credential-expiry-reminder',
        { credentialId: credential.id, daysOut: 60 },
        { delay: Math.max(0, sixtyDaysBefore.getTime() - Date.now()) },
      );
      await this.verificationQueue.add(
        'credential-expiry-reminder',
        { credentialId: credential.id, daysOut: 30 },
        { delay: Math.max(0, thirtyDaysBefore.getTime() - Date.now()) },
      );
    }

    return credential;
  }
}
```

> ⚠️ **Block duplicate pending submissions.** Without this check, a frustrated user double-tapping "submit" creates multiple PENDING verification rows, confusing the admin review queue. One pending submission per user at a time.

> ⚠️ **HS role is blocked from `submitCredential` entirely — by design.** Students don't hold professional licences; their verification is identity + student ID (covered in the worker frontend doc), not professional credentials.

---

## 📜 Step 2 — VerificationModule (Credentials, HW only)

### Controller

```typescript
// src/modules/verification/verification.controller.ts
import { Controller, Post, Get, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VerificationService } from './verification.service';

@Controller('verification')
export class VerificationController {
  constructor(private verificationService: VerificationService) {}

  @Roles('HW', 'HS')
  @Post('identity')
  async submitIdentity(@CurrentUser() user, @Body() dto: SubmitIdentityDto) {
    return this.verificationService.submitIdentity(user.sub, dto);
  }

  @Roles('HW', 'HS')
  @Get('identity/status')
  async getIdentityStatus(@CurrentUser() user) {
    return this.verificationService.getStatus(user.sub);
  }

  @Roles('HW')
  @Post('credentials')
  async submitCredential(@CurrentUser() user, @Body() dto: any) {
    return this.verificationService.submitCredential(user.sub, dto, user.role);
  }

  @Roles('HW')
  @Get('credentials')
  async listCredentials(@CurrentUser() user) {
    return this.verificationService.listCredentials(user.sub);
  }

  @Roles('HW')
  @Delete('credentials/:id')
  async deleteCredential(@CurrentUser() user, @Param('id') id: string) {
    return this.verificationService.deleteCredential(user.sub, id);
  }
}
```

```typescript
// verification.service.ts (continued)
async deleteCredential(workerId: string, credentialId: string) {
  const credential = await this.prisma.credential.findUnique({ where: { id: credentialId } });
  if (!credential || credential.workerId !== workerId) {
    throw new ForbiddenException('Cannot delete this credential');
  }
  if (credential.status !== 'PENDING') {
    throw new BadRequestException('Cannot delete a credential that has already been reviewed');
  }
  return this.prisma.credential.delete({ where: { id: credentialId } });
}
```

---

## 🔍 Step 3 — WorkersModule (Search)

### Full-text search index

```prisma
// Add to WorkerProfile model
model WorkerProfile {
  // ...existing fields...

  @@index([state, lga, workerType, verificationStatus, avgRating])
}
```

```sql
-- Run as a raw migration: add Postgres FTS column + GIN index
ALTER TABLE worker_profiles ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce("fullName", '') || ' ' || coalesce(bio, '') || ' ' || array_to_string(skills, ' '))
  ) STORED;

CREATE INDEX worker_search_idx ON worker_profiles USING GIN (search_vector);
```

```bash
npx prisma migrate dev --name add_search_vector --create-only
# Manually edit the generated migration file to include the SQL above, then:
npx prisma migrate dev
```

> ⚠️ **Generated columns require a raw SQL migration.** Prisma's schema language doesn't natively support `GENERATED ALWAYS AS` columns — use `--create-only` to generate an empty migration file, then hand-write the SQL inside it.

### Search DTO

```typescript
// src/modules/workers/dto/search-workers.dto.ts
import { IsOptional, IsString, IsNumber, IsArray, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { WorkerType } from '@prisma/client';

export class SearchWorkersDto {
  @IsOptional() @IsString()
  q?: string;

  @IsOptional() @IsString()
  state?: string;

  @IsOptional() @IsString()
  lga?: string;

  @IsOptional() @IsString()
  categoryId?: string;

  @IsOptional() @Type(() => Number) @IsNumber()
  minRating?: number;

  @IsOptional() @Type(() => Number) @IsNumber()
  minRateKobo?: number;

  @IsOptional() @Type(() => Number) @IsNumber()
  maxRateKobo?: number;

  @IsOptional() @IsEnum(WorkerType)
  workerType?: WorkerType;

  @IsOptional() @IsArray()
  languages?: string[];

  @IsOptional() @IsString()
  sort?: 'rating' | 'price_asc' | 'price_desc' | 'experience';

  @IsOptional() @IsString()
  cursor?: string;

  @IsOptional() @Type(() => Number) @IsNumber()
  limit?: number = 20;
}
```

### Service — search with caching

```typescript
// src/modules/workers/workers.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { SearchWorkersDto } from './dto/search-workers.dto';

@Injectable()
export class WorkersService {
  constructor(private prisma: PrismaService, private redis: RedisService) {}

  async search(dto: SearchWorkersDto) {
    const cacheKey = `search:${JSON.stringify(dto)}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const orderBy = this.buildOrderBy(dto.sort);

    const results = await this.prisma.workerProfile.findMany({
      where: {
        verificationStatus: 'VERIFIED',
        isAvailable: true,
        ...(dto.state && { state: dto.state }),
        ...(dto.lga && { lga: dto.lga }),
        ...(dto.workerType && { workerType: dto.workerType }),
        ...(dto.minRating && { avgRating: { gte: dto.minRating } }),
        ...(dto.minRateKobo && { hourlyRateKobo: { gte: BigInt(dto.minRateKobo) } }),
        ...(dto.maxRateKobo && { hourlyRateKobo: { lte: BigInt(dto.maxRateKobo) } }),
        ...(dto.languages?.length && { languages: { hasSome: dto.languages } }),
      },
      orderBy,
      take: dto.limit,
      ...(dto.cursor && { cursor: { id: dto.cursor }, skip: 1 }),
    });

    const response = {
      items: results,
      meta: { next_cursor: results.at(-1)?.id, has_more: results.length === dto.limit },
    };

    await this.redis.setex(cacheKey, 60, JSON.stringify(response)); // 60s cache
    return response;
  }

  private buildOrderBy(sort?: string) {
    switch (sort) {
      case 'price_asc': return { hourlyRateKobo: 'asc' as const };
      case 'price_desc': return { hourlyRateKobo: 'desc' as const };
      case 'experience': return { yearsExperience: 'desc' as const };
      default: return { avgRating: 'desc' as const };
    }
  }
}
```

> ⚠️ **Only `VERIFIED` and `isAvailable: true` workers ever appear in search.** This filter must be unconditional — never let a query parameter override it. A pending or suspended worker showing up in search results is both a trust violation and, for suspended accounts, a safety issue.

> ⚠️ **BigInt in Redis cache keys.** `JSON.stringify(dto)` works fine since the DTO's rate fields are plain numbers (Naira-equivalent kobo as a number, not BigInt) — the BigInt conversion only happens inside the Prisma query itself.

---

## 📅 Step 4 — AvailabilityModule

### Schema

```prisma
model AvailabilitySlot {
  id        String @id @default(cuid())
  workerId  String
  dayOfWeek Int    // 0 = Sunday, 6 = Saturday
  startTime String // "08:00"
  endTime   String // "18:00"

  workerProfile WorkerProfile @relation(fields: [workerId], references: [id], onDelete: Cascade)

  @@map("availability_slots")
}

model AvailabilityBlock {
  id        String   @id @default(cuid())
  workerId  String
  startDate DateTime @db.Date
  endDate   DateTime @db.Date
  reason    String?

  workerProfile WorkerProfile @relation(fields: [workerId], references: [id], onDelete: Cascade)

  @@map("availability_blocks")
}
```

### Service — conflict detection

```typescript
// src/modules/availability/availability.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class AvailabilityService {
  constructor(private prisma: PrismaService) {}

  async setWeeklySchedule(workerId: string, slots: { dayOfWeek: number; startTime: string; endTime: string }[]) {
    // Check for conflicts with already-confirmed bookings before allowing the change
    const upcomingBookings = await this.prisma.booking.findMany({
      where: {
        workerId,
        status: { in: ['CONFIRMED', 'IN_PROGRESS'] },
        scheduledStart: { gte: new Date() },
      },
    });

    for (const booking of upcomingBookings) {
      const bookingDay = booking.scheduledStart.getDay();
      const matchingSlot = slots.find(s => s.dayOfWeek === bookingDay);
      if (!matchingSlot) {
        throw new BadRequestException(
          `Cannot remove availability on this day — you have a confirmed booking on ${booking.scheduledStart.toDateString()}`
        );
      }
    }

    await this.prisma.availabilitySlot.deleteMany({ where: { workerId } });
    return this.prisma.availabilitySlot.createMany({
      data: slots.map(s => ({ workerId, ...s })),
    });
  }

  async addBlock(workerId: string, startDate: Date, endDate: Date, reason?: string) {
    const conflicting = await this.prisma.booking.findFirst({
      where: {
        workerId,
        status: { in: ['CONFIRMED', 'IN_PROGRESS'] },
        scheduledStart: { gte: startDate, lte: endDate },
      },
    });
    if (conflicting) {
      throw new BadRequestException('This date range overlaps a confirmed booking');
    }

    return this.prisma.availabilityBlock.create({
      data: { workerId, startDate, endDate, reason },
    });
  }

  async togglePause(workerId: string, isAvailable: boolean) {
    return this.prisma.workerProfile.update({
      where: { id: workerId },
      data: { isAvailable },
    });
  }
}
```

> ⚠️ **Conflict detection must run before the schedule is overwritten.** The `deleteMany` + `createMany` pattern above only executes after the conflict check passes — never delete the old schedule first and validate after, or a failed validation leaves the worker with no schedule at all.

---

## 📡 API Reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/verification/identity` | JWT (hw\|hs) | Submit NIN + ID + selfie |
| GET | `/verification/identity/status` | JWT (hw\|hs) | Check own verification status |
| POST | `/verification/credentials` | JWT (hw) | Upload a professional credential |
| GET | `/verification/credentials` | JWT (hw) | List own credentials |
| DELETE | `/verification/credentials/:id` | JWT (hw) | Remove a credential (pre-review only) |
| GET | `/caregivers` | Public | Search verified caregivers with filters |
| GET | `/caregivers/:id` | JWT (client) | Get full public caregiver profile |
| GET | `/caregivers/:id/availability` | JWT (client) | Get worker's available slots for a date range |
| GET | `/availability` | JWT (hw\|hs) | Get own recurring availability |
| PUT | `/availability` | JWT (hw\|hs) | Replace full weekly availability |
| POST | `/availability/blocks` | JWT (hw\|hs) | Add a date-specific block |
| DELETE | `/availability/blocks/:id` | JWT (hw\|hs) | Remove a date block |
| PATCH | `/availability/pause` | JWT (hw\|hs) | Toggle full availability pause |

---

## ✅ Verification Checklist

- [ ] POST `/verification/identity` rejects a second submission while one is PENDING
- [ ] POST `/verification/credentials` as a client or student returns 403
- [ ] Credential with an `expiresAt` 90 days out queues both reminder jobs (check BullMQ dashboard)
- [ ] GET `/caregivers` only returns workers with `verificationStatus=VERIFIED`
- [ ] GET `/caregivers?state=Lagos&minRating=4` correctly filters results
- [ ] GET `/caregivers?sort=price_asc` returns ascending `hourlyRateKobo` order
- [ ] Search results are served from Redis cache on a second identical request within 60s (check Redis directly)
- [ ] PUT `/availability` rejects a schedule change that would remove a day with a confirmed booking
- [ ] POST `/availability/blocks` rejects a date range overlapping a confirmed booking
- [ ] PATCH `/availability/pause` immediately removes the worker from search results

---

## ⚠️ Common Pitfalls

> **Pitfall: forgetting the `isAvailable` filter in search.**
> A worker who has paused availability should never appear in search, regardless of verification status. This is easy to miss if you add new search filters later — always keep the unconditional base filters (`verificationStatus: 'VERIFIED'`, `isAvailable: true`) at the top of the `where` clause as a visual reminder they're non-negotiable.

> **Pitfall: GIN index migration drift.**
> Because the `search_vector` column is hand-written SQL rather than Prisma-native, running `prisma migrate reset` in development will correctly reapply it (it's in the migration history), but if you ever hand-edit the schema and run `prisma db pull`, the generated column may not introspect correctly. Keep a copy of the raw SQL outside the migration folder as a reference.

> **Pitfall: caching search results too aggressively.**
> 60 seconds is a reasonable TTL for the MVP, but if a worker accepts a booking and becomes unavailable, search results could show them as available for up to 60 seconds afterward. This is an acceptable MVP trade-off — flag it for cache invalidation on booking acceptance in a later iteration if it becomes a problem.

---

## ➡️ Next Phase

Move to **Phase 5 — Bookings**, the most complex module in the system. It depends directly on `AvailabilityModule` for conflict detection and `WorkersModule` for the worker being booked.