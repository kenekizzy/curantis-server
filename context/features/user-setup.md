# Phase 3 — Users, Profiles & Storage

> UsersModule · ProfilesModule · StorageModule (S3 presigned uploads)
> **Estimated time:** ~2 days

---

## 📋 Table of Contents

- [Goal](#-goal)
- [Step 1 — UsersModule](#-step-1--usersmodule)
- [Step 2 — ProfilesModule](#-step-2--profilesmodule)
- [Step 3 — StorageModule (S3 Presigned)](#-step-3--storagemodule-s3-presigned)
- [Current User Decorator](#-current-user-decorator)
- [API Reference](#-api-reference)
- [Verification Checklist](#-verification-checklist)
- [Common Pitfalls](#-common-pitfalls)

---

## 🎯 Goal

Every user gets a role-specific profile — clients describe who they need care for, workers and students describe what they offer. This phase also establishes the S3 upload pattern used by every later module that handles files (verification documents, credentials, chat attachments).

---

## 👤 Step 1 — UsersModule

`UsersModule` has no upward dependencies — every other module imports it, it imports nothing feature-specific. Keep it that way.

```typescript
// src/modules/users/users.controller.ts
import { Controller, Get, Patch, Body } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/types/jwt-payload.type';
import { UsersService } from './users.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get('me')
  async getMe(@CurrentUser() user: JwtPayload) {
    return this.usersService.findById(user.sub);
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: JwtPayload, @Body() dto: UpdateUserDto) {
    return this.usersService.update(user.sub, dto);
  }
}
```

```typescript
// src/modules/users/dto/update-user.dto.ts
import { IsOptional, IsEmail, IsPhoneNumber } from 'class-validator';

export class UpdateUserDto {
  @IsOptional() @IsEmail()
  email?: string;

  @IsOptional() @IsPhoneNumber('NG')
  phone?: string;
}
```

```typescript
// src/modules/users/users.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, phone: true, role: true, status: true, createdAt: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(id: string, dto: UpdateUserDto) {
    return this.prisma.user.update({ where: { id }, data: dto });
  }
}
```

> ⚠️ **A user can never change their own status.** There is deliberately no `status` field in `UpdateUserDto`. Suspension and deactivation are admin-only actions covered in Phase 8.

---

## 🧾 Step 2 — ProfilesModule

### Schema

```prisma
// prisma/schema.prisma

model ClientProfile {
  id                 String   @id @default(cuid())
  userId             String   @unique
  fullName           String
  avatarUrl          String?
  state              String
  lga                String
  careRecipientName  String?
  careRecipientAge   Int?
  careRecipientRel   String?
  careNeedsSummary   String?  @db.Text
  emergencyName      String?
  emergencyPhone     String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("client_profiles")
}

enum WorkerType {
  HW
  HS
}

enum VerificationStatus {
  PENDING
  VERIFIED
  REJECTED
  SUSPENDED
}

model WorkerProfile {
  id                 String              @id @default(cuid())
  userId             String              @unique
  fullName           String
  avatarUrl          String?
  bio                String?             @db.VarChar(500)
  workerType         WorkerType
  yearsExperience    Int?
  institution        String?
  gradYear           Int?
  fieldOfStudy       String?
  hourlyRateKobo     BigInt
  state              String
  lga                String
  languages          String[]            @default([])
  skills             String[]            @default([])
  isAvailable        Boolean             @default(true)
  verificationStatus VerificationStatus  @default(PENDING)
  avgRating          Decimal             @default(0.00) @db.Decimal(3, 2)
  reviewCount        Int                 @default(0)
  createdAt          DateTime            @default(now())
  updatedAt          DateTime            @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([state, lga, workerType, verificationStatus, avgRating])
  @@map("worker_profiles")
}
```

```bash
npx prisma migrate dev --name add_profiles
```

### DTOs — role-aware validation

```typescript
// src/modules/profiles/dto/create-worker-profile.dto.ts
import { IsString, IsNumber, Min, IsOptional, IsArray, IsEnum, ValidateIf } from 'class-validator';
import { WorkerType } from '@prisma/client';

export class CreateWorkerProfileDto {
  @IsString()
  fullName: string;

  @IsOptional() @IsString()
  bio?: string;

  @IsEnum(WorkerType)
  workerType: WorkerType;

  @IsNumber() @Min(500)
  hourlyRate: number; // ₦ — converted to kobo in service

  @IsString()
  state: string;

  @IsString()
  lga: string;

  @IsOptional() @IsArray()
  languages?: string[];

  @IsOptional() @IsArray()
  skills?: string[];

  // Student-only fields — required only if workerType === HS
  @ValidateIf(o => o.workerType === WorkerType.HS)
  @IsString()
  institution?: string;

  @ValidateIf(o => o.workerType === WorkerType.HS)
  @IsNumber()
  gradYear?: number;

  @ValidateIf(o => o.workerType === WorkerType.HS)
  @IsString()
  fieldOfStudy?: string;
}
```

### Service — upsert with kobo conversion

```typescript
// src/modules/profiles/profiles.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateWorkerProfileDto } from './dto/create-worker-profile.dto';
import { CreateClientProfileDto } from './dto/create-client-profile.dto';

@Injectable()
export class ProfilesService {
  constructor(private prisma: PrismaService) {}

  async upsertWorkerProfile(userId: string, dto: CreateWorkerProfileDto) {
    if (dto.workerType === 'HS' && (!dto.institution || !dto.gradYear)) {
      throw new BadRequestException('Students must provide institution and graduation year');
    }

    const hourlyRateKobo = BigInt(Math.round(dto.hourlyRate * 100));

    return this.prisma.workerProfile.upsert({
      where: { userId },
      create: { userId, ...dto, hourlyRateKobo, hourlyRate: undefined },
      update: { ...dto, hourlyRateKobo, hourlyRate: undefined },
    });
  }

  async upsertClientProfile(userId: string, dto: CreateClientProfileDto) {
    return this.prisma.clientProfile.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
  }

  async getOwnProfile(userId: string, role: string) {
    if (role === 'CLIENT') {
      return this.prisma.clientProfile.findUnique({ where: { userId } });
    }
    return this.prisma.workerProfile.findUnique({ where: { userId } });
  }

  async getPublicProfile(userId: string) {
    const profile = await this.prisma.workerProfile.findUnique({
      where: { userId },
      select: {
        fullName: true, avatarUrl: true, bio: true, workerType: true,
        yearsExperience: true, hourlyRateKobo: true, state: true, lga: true,
        languages: true, skills: true, verificationStatus: true,
        avgRating: true, reviewCount: true,
        // Never expose: institution, gradYear (private to student themselves)
      },
    });
    return profile;
  }
}
```

> ⚠️ **Always calculate kobo server-side from a Naira input.** Never accept a `hourlyRateKobo` field directly from the client — accept `hourlyRate` in Naira (a normal number) and convert with `BigInt(Math.round(value * 100))` inside the service. This prevents clients from sending malformed or precision-lossy BigInt strings.

> ⚠️ **The public profile selector must exclude student-private fields.** `institution` and `gradYear` are visible to admins and the student themselves, but should not appear in `GET /caregivers/:id` results — a client doesn't need a student's school name.

---

## 📦 Step 3 — StorageModule (S3 Presigned)

```bash
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

```env
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=eu-west-1
AWS_S3_BUCKET=caregiverng-documents
```

### StorageService

```typescript
// src/infrastructure/storage/storage.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

@Injectable()
export class StorageService {
  private client = new S3Client({ region: process.env.AWS_REGION });
  private bucket = process.env.AWS_S3_BUCKET!;

  async getPresignedUploadUrl(key: string, mimeType: string, fileSize: number) {
    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      throw new BadRequestException('Unsupported file type');
    }
    if (fileSize > MAX_FILE_SIZE) {
      throw new BadRequestException('File exceeds 5MB limit');
    }

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
    });

    const url = await getSignedUrl(this.client, command, { expiresIn: 300 }); // 5 min to upload
    return { uploadUrl: url, fileUrl: `https://${this.bucket}.s3.amazonaws.com/${key}` };
  }

  async getPresignedDownloadUrl(key: string) {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: 604_800 }); // 7 days
  }

  buildKey(prefix: string, userId: string, filename: string): string {
    const sanitized = filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    return `${prefix}/${userId}/${Date.now()}-${sanitized}`;
  }
}
```

### Avatar upload endpoint

```typescript
// src/modules/users/users.controller.ts (continued)
import { StorageService } from '../../infrastructure/storage/storage.service';

@Post('me/avatar')
async getAvatarUploadUrl(
  @CurrentUser() user: JwtPayload,
  @Body() dto: { mimeType: string; fileSize: number },
) {
  const key = this.storageService.buildKey('avatars', user.sub, 'avatar.jpg');
  return this.storageService.getPresignedUploadUrl(key, dto.mimeType, dto.fileSize);
}
```

> ⚠️ **NestJS never touches the raw file bytes.** The pattern is: client asks the backend for a presigned URL, backend validates type/size and returns a signed S3 URL, client uploads directly to S3 from the browser. This keeps your API server stateless and avoids streaming large files through your own infrastructure.

---

## 🎯 Current User Decorator

```typescript
// src/common/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../types/jwt-payload.type';

export const CurrentUser = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```

---

## 📡 API Reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| GET | `/users/me` | JWT (any) | Get own user record |
| PATCH | `/users/me` | JWT (any) | Update own user fields |
| GET | `/users/me/profile` | JWT (any) | Get own role-specific profile |
| PUT | `/users/me/profile` | JWT (any) | Create or replace own profile |
| PATCH | `/users/me/profile` | JWT (any) | Partial update own profile |
| POST | `/users/me/avatar` | JWT (any) | Get presigned upload URL for avatar |
| GET | `/users/:id/profile` | JWT (client) | View a worker's public profile |

---

## ✅ Verification Checklist

- [ ] GET `/users/me` returns the authenticated user's own record only
- [ ] PUT `/users/me/profile` as a client creates a `client_profiles` row
- [ ] PUT `/users/me/profile` as a worker creates a `worker_profiles` row with `hourlyRateKobo` correctly converted
- [ ] PUT `/users/me/profile` as a student without `institution`/`gradYear` returns 400
- [ ] GET `/users/:id/profile` never returns `institution` or `gradYear` even for a student
- [ ] POST `/users/me/avatar` with an unsupported MIME type (e.g. `video/mp4`) returns 400
- [ ] POST `/users/me/avatar` with a file over 5MB returns 400
- [ ] Returned presigned URL successfully accepts a direct PUT upload from Postman or curl

---

## ⚠️ Common Pitfalls

> **Pitfall: trusting client-provided kobo values.**
> If a DTO field is named anything like `hourlyRateKobo` and accepted directly from the request body, a malicious or buggy client could submit a negative number, a non-integer string, or an absurdly large value. Always accept the human-readable Naira amount and convert server-side.

> **Pitfall: exposing student-private fields in public search results.**
> It's easy to forget the `select` clause when adding new fields to `WorkerProfile` later — any new field defaults to being included unless explicitly excluded. Review `getPublicProfile`'s select list whenever the schema changes.

> **Pitfall: presigned URL expiry mismatches.**
> If the upload URL expires before the user finishes selecting and uploading a large file (slow connection, big PDF), the upload silently fails. 5 minutes is a reasonable default — extend it if you see failures correlating with file size in your logs.

---

## ➡️ Next Phase

Move to **Phase 4 — Verification & Search**, which builds directly on the `StorageService` established here for identity document and credential uploads.

---
