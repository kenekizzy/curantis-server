# Current Feature

Phase 10 — Unit Test Coverage

## Status

Completed

## Goal

Add Jest unit tests across the whole `src/` tree — every guard, filter, interceptor, service, controller with real logic, processor, cron, listener, webhook, and the socket gateway — each mocking out Prisma/Redis/BullMQ/EventEmitter2/axios/Cloudinary/Resend so nothing touches a real database, queue, or third-party API.

## Requirements

- 48 source files covered by 46 new `.spec.ts` files, ~246 tests total, all passing; `npm run build` still clean.
- Thin 1-to-1 pass-through controllers with zero branching logic (e.g. `workers.controller.ts`) were intentionally skipped — nothing to verify beyond restating the code. Controllers with real logic (role branching, date parsing, dispute-decision routing, audit logging) got tests.
- Every test file leads with a short plain-English/analogy comment explaining what it checks and why, per the user's request.

## References

## History

### Phase 10 — Unit Test Coverage (2026-07-12)
- Fixed `package.json` jest config: added `moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" }` — without this, ts-jest cannot resolve this project's NodeNext-style relative imports (`from './x.service.js'`) at all, so **no spec file could run** before this fix. Verified with a throwaway smoke test before writing real tests.
- Added spec files for: all 3 guards, both filters, both interceptors, `storage.service`; `auth.service/.controller`, both Passport strategies, `users.service/.controller`; `profiles.service/.controller`, `verification.service/.controller`, `workers.service`, `worker-account.controller`, `availability.service/.controller`; `bookings.service/.cron`, `bookings.processor`; `payments.service/.listener`, `payouts.processor`, both Paystack/Flutterwave webhooks; `reviews.service/.cron`, `reports.service`; `notifications.service/.listener/.processor`, `mail.service`, `chat.service`; `admin-logger.service`, `admin-verifications.service`, `admin-bookings/.payments/.users/.reviews/.auth` controllers, `socket.gateway`
- Mocking approach: no `@nestjs/testing` `TestingModule` — services are plain classes with constructor-injected dependencies, so tests just `new Service(...mocks)` directly with `jest.fn()` stand-ins; `axios`, `cloudinary`, and `resend` are mocked at the module level (`jest.mock(...)`) since they're imported directly rather than injected
- Fixed a real bug surfaced while writing the payments tests: the `payments.service.spec.ts` mock was initially missing `prisma.payment.update`, which caused `issueRefund`'s `$transaction` array to throw synchronously when building — caught this via the tests themselves before it shipped
- Full suite: `npm run test` → 46 suites, 246 tests, all passing. `npm run build` → clean.
- Note: no git branch was created for this work — the repo currently has zero commits (`git log` shows no HEAD), so there's nothing to branch from yet; flagged to the user, awaiting direction on an initial commit

### Phase 9 — Cloudinary Storage Migration (2026-07-12)
- Removed: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
- Installed: `cloudinary@^2.10.0`
- Rewrote `src/infrastructure/storage/storage.service.ts` — `getUploadSignature(opts)` replaces `getPresignedUploadUrl`/`getPresignedDownloadUrl`; signs `{ timestamp, folder, public_id? }` via `cloudinary.utils.api_sign_request`, resolves `resourceType` (`image`/`video`/`raw`) from the MIME type, and takes `allowedMimeTypes`/`maxSizeBytes` from the caller instead of hardcoding them (fixes a pre-existing bug where chat's 10MB limit was silently overridden by the old service's hardcoded 5MB S3 check); `buildKey` renamed `buildPublicId` (drops the S3-specific prefix argument — folder now carries that)
- Updated `src/modules/users/users.controller.ts` — avatar upload derives file extension from MIME type (was hardcoded to `.jpg` regardless of actual image type) and calls `getUploadSignature` with a 5MB image-only allowlist
- Updated `src/modules/chat/chat.service.ts` — `uploadAttachment` calls `getUploadSignature` with folder `chat/{conversationId}`; extended `ALLOWED_CHAT_TYPES` to match what `overall-project-structure.md` already documented but was never implemented (`image/gif`, `audio/mpeg`, `audio/ogg`) — unblocks the audio-attachment TODO logged in Phase 8
- Updated `.env` — `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_REGION`/`AWS_S3_BUCKET` replaced with `CLOUDINARY_CLOUD_NAME`/`CLOUDINARY_API_KEY`/`CLOUDINARY_API_SECRET` (values still need to be filled in from the Cloudinary dashboard before running)
- Updated `context/project-overview.md` and `context/overall-project-structure.md` — tech stack tables, architecture diagrams, chat upload flow/sequence diagram, and schema comments now describe the Cloudinary signed-upload flow instead of S3
- Note: verification identity/credential document URLs (`idDocUrl`, `selfieUrl`, `documentUrl`) are still accepted as plain string fields — `VerificationController` never called `StorageService` directly even before this migration, so that gap is unchanged, not introduced by this phase
- Note: response shape changed — the old S3 flow returned a deterministic `fileUrl` alongside `uploadUrl`; Cloudinary decides the final `secure_url` at upload time, so callers must use the `secure_url` from Cloudinary's own upload response rather than a URL predicted in advance
- Build passes: `npm run build` ✅ (no test suite exists yet in this repo to run against)
- **Before running:** create a Cloudinary account/cloud, fill in `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` in `.env`

### Phase 8 — Admin Module + Socket.io (2026-06-30)
- Installed: `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`
- Updated `prisma/schema.prisma` — added `AdminRole` enum, `AdminProfile` model, `AdminLog` model, `Conversation` model, `Message` model; regenerated client
- Created `src/common/decorators/admin-role.decorator.ts` — `@AdminRoles(...roles: AdminRole[])` with `SetMetadata`
- Created `src/common/guards/admin-roles.guard.ts` — DB lookup on `AdminProfile` only when `@AdminRoles` metadata present; fast-path returns `true` with no query otherwise; added as 4th global `APP_GUARD`
- Created `src/modules/admin/services/admin-logger.service.ts` — append-only `AdminLog` row; metadata typed via Prisma method signature
- Created `src/modules/admin/services/admin-verifications.service.ts` — `getQueue(status)`, `review` (update Verification + WorkerProfile.verificationStatus on approve, emit `verification.status_changed`)
- Created `src/modules/admin/controllers/admin-users.controller.ts` — `GET /admin/users` (filters: role, status), `PATCH /admin/users/:id/status` (`@AdminRoles(SUPER_ADMIN, SUPPORT_AGENT)`)
- Created `src/modules/admin/controllers/admin-verifications.controller.ts` — `GET /admin/verifications`, `PATCH /admin/verifications/:id` (`@AdminRoles(SUPER_ADMIN, VERIFICATION_OFFICER)`)
- Created `src/modules/admin/controllers/admin-bookings.controller.ts` — `GET /admin/bookings`, `PATCH /admin/bookings/:id/cancel`, `PATCH /admin/bookings/disputes/:id/resolve` (`@AdminRoles(SUPER_ADMIN, SUPPORT_AGENT)`); dispute resolution calls `PaymentsService.issueRefund` or queues `release-escrow` job; emits `dispute.resolved`
- Created `src/modules/admin/controllers/admin-payments.controller.ts` — `GET /admin/payments`, `POST /admin/payments/:id/refund`, `GET /admin/payments/payouts`, `PATCH /admin/payments/payouts/:id/release` (`@AdminRoles(SUPER_ADMIN, FINANCE_OFFICER)`)
- Created `src/modules/admin/controllers/admin-reviews.controller.ts` — `GET /admin/reviews`, `DELETE /admin/reviews/:id`, `PATCH /admin/reviews/:id/restore` (`@AdminRoles(SUPER_ADMIN, SUPPORT_AGENT)`)
- Created `src/modules/admin/controllers/admin-reports.controller.ts` — `GET /admin/reports`, `PATCH /admin/reports/:id` (`@AdminRoles(SUPER_ADMIN, SUPPORT_AGENT)`)
- Created `src/modules/admin/controllers/admin-analytics.controller.ts` — `GET /admin/analytics` (user/booking/revenue counts), `GET /admin/logs` (`@AdminRoles(SUPER_ADMIN)`)
- Created `src/modules/admin/admin.module.ts` — imports `PaymentsModule` + `BullModule.registerQueue('payouts')`
- Created `src/infrastructure/socket/socket.gateway.ts` — `@WebSocketGateway({ cors, namespace: '/chat' })`; JWT verify with RS256 public key on `handleConnection` (disconnect on failure); presence via Redis SETEX 90s; `chat:join` (canAccess + room join + history + markRead), `chat:send` (canAccess + persistMessage + broadcast + ack), `chat:typing` (relay), `chat:read` (markRead + relay), `chat:heartbeat` (refresh TTL)
- Created `src/infrastructure/socket/socket.module.ts` — imports `JwtModule.register({})` + `ChatModule`
- Created `src/modules/chat/chat.service.ts` — `canAccess` (admin check first, then participant check, then booking status: CONFIRMED/IN_PROGRESS/COMPLETED-within-7-days), `getHistory`, `persistMessage`, `markRead`, `uploadAttachment` (MIME + 10MB size guard, S3 presigned URL; supported types: jpeg/png/webp/pdf)
- Created `src/modules/chat/chat.controller.ts` — `GET /chat/:id/messages`, `POST /chat/upload`, `GET /chat/presence/:userId` (Redis lookup via injected RedisService)
- Created `src/modules/chat/chat.module.ts` — exports `ChatService`
- Updated `src/modules/notifications/notifications.listener.ts` — added `dispute.resolved` handler (notifies both client and worker)
- Updated `app.module.ts` — added `AdminModule`, `ChatModule`, `SocketModule`; added `AdminRolesGuard` as 4th `APP_GUARD`
- Note: `@Roles(Role.ADMIN)` applied at controller class level on all admin controllers — not per-method
- Note: Dispute endpoint is at `PATCH /admin/bookings/disputes/:id/resolve` (not `/admin/disputes/:id/resolve`)
- Note: Chat MIME type support is jpeg/png/webp/pdf — audio types deferred pending StorageService extension
- Build passes: `npm run build` ✅
- **Before running:** run `npx prisma migrate dev --name add_admin_and_chat`

## History

### Phase 7 — Reviews, Reports & Notifications (2026-06-30)
- Installed: `resend`
- Updated `prisma/schema.prisma` — added `ReviewStatus` enum, `Review` model (`bookingId @unique`), `Report` model (optional `bookingId`, `imageUrls String[]`), `Notification` model; added `review Review?` and `reports Report[]` back-relations to `Booking`; regenerated client
- Created `src/modules/reviews/dto/create-review.dto.ts`, `update-review.dto.ts`
- Created `src/modules/reviews/reviews.service.ts` — `create` (COMPLETED + ownership guard, duplicate guard via unique constraint, `recalculateWorkerRating` after create), `update` (ownership + 48hr window guard, sets `editedAt`, recalculates rating), `flag` (updates status to FLAGGED), `recalculateWorkerRating` (aggregates PUBLISHED reviews, updates `workerProfile`)
- Created `src/modules/reviews/reviews.cron.ts` — `@Cron(EVERY_HOUR)` `updateMany` reviews older than 48hr with `lockedAt = null` → `lockedAt = now()`
- Created `src/modules/reviews/reviews.controller.ts` — `POST /reviews` (CLIENT), `PATCH /reviews/:id` (CLIENT), `POST /reviews/:id/flag` (any auth)
- Created `src/modules/reviews/reviews.module.ts`
- Created `src/modules/reports/dto/create-report.dto.ts` — `@IsIn` guard on category enum, `imageUrls?` string array
- Created `src/modules/reports/reports.service.ts` — `create` (max-3 images guard, booking relationship verification, `report.escalated` emitted for safety_concern+misconduct, `report.unverified` emitted when no booking relationship), `listOwn`, `findOne`
- Created `src/modules/reports/reports.controller.ts` — `POST /reports`, `GET /reports/me`, `GET /reports/:id`
- Created `src/modules/reports/reports.module.ts`
- Created `src/modules/notifications/notifications.service.ts` — `listForUser` (last 50, desc), `markRead` (ownership check)
- Created `src/modules/notifications/notifications.listener.ts` — `@OnEvent` on: `booking.created` (notify worker), `booking.accepted` (notify client), `booking.completed` (notify both with `addBulk`), `payment.successful` (notify client), `verification.status_changed` (notify worker), `report.escalated` (queue `alert-super-admin`)
- Created `src/modules/notifications/processors/notifications.processor.ts` — `send-notification`: persist Notification row + send email via Resend; `send-otp`/`send-otp-sms`: SMS via Termii fetch; `alert-super-admin`: finds all ADMIN users, creates Notification rows for each; metadata type derived from Prisma method signature (Prisma 6 removed `Prisma.InputJsonValue`)
- Created `src/modules/notifications/notifications.controller.ts` — `GET /notifications`, `PATCH /notifications/:id/read`
- Created `src/modules/notifications/notifications.module.ts` — `BullModule.registerQueue({ name: 'notifications', attempts: 3, backoff: exponential 5s })`
- Updated `app.module.ts` — added `ReviewsModule`, `ReportsModule`, `NotificationsModule`
- Build passes: `npm run build` ✅
- **Before running:** run `npx prisma migrate dev --name add_reviews_reports_notifications`

### Phase 6 — Payments (Paystack + Flutterwave + Escrow) (2026-06-30)
- Installed: `axios`
- Updated `prisma/schema.prisma` — added `PaymentGateway` enum, `PaymentStatus` enum, `Payment` model, `Refund` model, `BankAccount` model; removed `paymentId` from `Booking` and added `payment Payment?` back-relation; regenerated client
- Created `src/modules/payments/dto/initiate-payment.dto.ts`, `add-bank-account.dto.ts`
- Created `src/modules/payments/payments.service.ts` — `initiate` (ACCEPTED guard, re-payment block, Paystack init, upsert PENDING), `handlePaymentSuccess` (idempotent via `gatewayRef` lookup + SUCCESSFUL early return, `$transaction` to mark SUCCESSFUL + booking CONFIRMED, emit `payment.successful`), `issueRefund` (amount guard, create Refund PENDING, Paystack API, `$transaction` update both on success, FAILED on error), `addBankAccount` (Paystack resolve API, max-2 guard, first account auto-default), `listBankAccounts`, `setDefaultAccount` (`updateMany` unset all + `update` set one), `deleteAccount` (pending payout guard), `getEarnings` (aggregate sum by COMPLETED bookings: total / pending escrow / available), `getPayment` (ownership check: client, worker, admin)
- Created `src/modules/payments/payments.listener.ts` — `@OnEvent('booking.completed')` → queue `release-escrow` on payouts queue (24hr delay, `jobId: escrow-release-{bookingId}`); `@OnEvent('booking.disputed')` → remove job from payouts queue
- Created `src/modules/payments/processors/payouts.processor.ts` — `release-escrow`: re-checks `booking.status !== DISPUTED`; finds default verified bank account; calls Paystack transfer API; throws on missing account (BullMQ retries)
- Created `src/modules/payments/webhooks/paystack.webhook.ts` — `@Public()`; HMAC-SHA512 over raw body (`x-paystack-signature`); dispatches `charge.success`; returns `{ received: true }` always
- Created `src/modules/payments/webhooks/flutterwave.webhook.ts` — `@Public()`; `verif-hash` header comparison; dispatches `charge.completed` + status `successful`
- Created `src/modules/payments/payments.controller.ts` — `POST /payments/initiate` (CLIENT), `GET /payments/:id` (any auth)
- Created `src/modules/payments/payments.module.ts` — `BullModule.registerQueue({ name: 'payouts', attempts: 3, backoff: fixed 1hr })`; exports `PaymentsService`
- Created `src/modules/workers/worker-account.controller.ts` — 5 endpoints at `workers/me/*` (HW+HS only): earnings, list/add/set-default/delete bank accounts
- Updated `src/modules/workers/workers.module.ts` — imports `PaymentsModule`, adds `WorkerAccountController`
- Updated `app.module.ts` — added `PaymentsModule`
- Updated `main.ts` — `bodyParser: false` on `NestFactory.create`; `express.raw({ type: 'application/json' })` on `/api/v1/payments/webhooks` before `express.json()` global parser
- Note: `BankAccount.workerId` references `User.id` (consistent with `Booking.workerId`)
- Note: Paystack transfer uses `bankAccount.id` as recipient — in production, create a Paystack transfer recipient (`/transferrecipient`) during `addBankAccount` and store the `recipient_code`
- Note: Flutterwave webhook uses `tx_ref` as the gateway reference (set during Flutterwave transaction init)
- Build passes: `npm run build` ✅
- **Before running:** run `npx prisma migrate dev --name add_payments`

### Phase 5 — Bookings (The Core Transaction) (2026-06-30)
- Installed: `@nestjs/schedule`
- Updated `prisma/schema.prisma` — added `BookingStatus` enum, `ServiceCategory` model, `Booking` model, `BookingLog` model; added `bookingsAsClient`/`bookingsAsWorker` relations to `User`; regenerated client
- Created `src/modules/bookings/dto/` — `create-booking.dto.ts`, `list-bookings.dto.ts`, `accept-booking.dto.ts`, `decline-booking.dto.ts`, `cancel-booking.dto.ts`, `dispute-booking.dto.ts`
- Created `src/modules/bookings/bookings.service.ts` — `create` (worker VERIFIED+isAvailable guard, HS restricted-category guard, race-condition-safe `$transaction` with overlap check, server-side kobo snapshot, 2hr auto-decline job at `jobId: auto-decline-{id}`), `accept`/`decline` (PENDING guard, auto-decline job removal), `cancel` (ADMIN bypass, terminal state block, auto-decline job removal), `start` (CONFIRMED guard), `complete` (IN_PROGRESS guard, `escrowReleaseAt` = now+24hr), `raiseDispute` (ownership check, emits `booking.disputed` for Phase 6 PaymentsModule to cancel payout), `list` (role-filtered: CLIENT→clientId, HW/HS→workerId, ADMIN→all; cursor pagination), `findOne`, `getLogs`
- Created `src/modules/bookings/processors/bookings.processor.ts` — `auto-decline` job: no-op if status ≠ PENDING; emits `booking.auto_declined`
- Created `src/modules/bookings/bookings.cron.ts` — `@Cron(EVERY_HOUR)` queries IN_PROGRESS bookings 2+ hours past `scheduledEnd`, updates to COMPLETED, logs `AUTO_COMPLETED`, emits `booking.completed`
- Created `src/modules/bookings/bookings.controller.ts` — all 10 endpoints
- Created `src/modules/bookings/bookings.module.ts` — `BullModule.registerQueue({ name: 'bookings' })`, `BookingsProcessor`, `BookingsCron`
- Created `prisma/seed.ts` — 8 service categories with `isRestricted: true` for Post-Hospital, Nursing, Live-In
- Updated `app.module.ts` — added `ScheduleModule.forRoot()`, `BookingsModule`
- Updated `src/modules/availability/availability.service.ts` — wired Phase 4 TODO stubs: `setWeeklySchedule` blocks if upcoming CONFIRMED/IN_PROGRESS bookings exist; `addBlock` checks for booking conflicts in date range
- Note: `ScheduleModule.forRoot()` is in `AppModule`, not BookingsModule, per NestJS best practice
- Note: ACCEPTED → CONFIRMED transition is handled by PaymentsModule (Phase 6) on payment webhook — `start` correctly requires CONFIRMED status
- Note: `raiseDispute` does not cancel the payout job directly — it emits `booking.disputed`; Phase 6 PaymentsModule will listen and cancel the `payouts` queue job
- Fix: `booking.status === COMPLETED || === CANCELLED` used instead of `.includes()` to satisfy TypeScript strict array literal narrowing
- Build passes: `npm run build` ✅
- **Before running:** run `npx prisma migrate dev --name add_bookings` then `npx ts-node prisma/seed.ts`

### Phase 4 — Verification, Search & Availability (2026-06-30)
- Updated `prisma/schema.prisma` — added `CredentialStatus` enum, `Verification` model, `Credential` model, `AvailabilitySlot` model, `AvailabilityBlock` model; added `credentials`, `availabilitySlots`, `availabilityBlocks` relations to `WorkerProfile`; regenerated client
- Created `src/modules/verification/dto/submit-identity.dto.ts`, `submit-credential.dto.ts`
- Created `src/modules/verification/verification.service.ts` — `submitIdentity` (blocks duplicate PENDING, queues `nin-lookup` job), `getStatus`, `submitCredential` (HW only, role double-checked in service, queues 60-day + 30-day expiry reminders), `listCredentials`, `deleteCredential` (blocked if status ≠ PENDING)
- Created `src/modules/verification/verification.controller.ts` — 5 endpoints at `/verification/*`
- Created `src/modules/verification/verification.module.ts` — `BullModule.registerQueue({ name: 'verification' })`
- Created `src/modules/workers/dto/search-workers.dto.ts` — all filters with `@Type(() => Number)` coercions
- Created `src/modules/workers/workers.service.ts` — `search` (unconditional `VERIFIED+isAvailable`, `OR` text search on `fullName`/`bio`, cursor pagination, 60s Redis cache with BigInt serialization), `getPublicProfile` (excludes `institution`/`gradYear`/`fieldOfStudy`), `getWorkerAvailability`
- Created `src/modules/workers/workers.controller.ts` — `GET /caregivers` (`@Public()`), `GET /caregivers/:id` (CLIENT), `GET /caregivers/:id/availability` (CLIENT)
- Created `src/modules/workers/workers.module.ts`
- Created `src/modules/availability/dto/set-schedule.dto.ts` (`SlotDto` nested with `HH:MM` `@Matches`), `add-block.dto.ts`, `toggle-pause.dto.ts`
- Created `src/modules/availability/availability.service.ts` — `getSchedule`, `setWeeklySchedule` (conflict check TODO for Phase 5, then deleteMany+createMany), `addBlock` (date order validation, conflict check TODO), `deleteBlock` (ownership check), `togglePause`
- Created `src/modules/availability/availability.controller.ts` — 5 endpoints at `/availability/*`
- Created `src/modules/availability/availability.module.ts`
- Updated `app.module.ts` — added `VerificationModule`, `WorkersModule`, `AvailabilityModule`
- Note: Booking conflict checks in `setWeeklySchedule` and `addBlock` are stubbed with TODOs — will be wired in Phase 5 when `Booking` model is added to schema
- Note: FTS `search_vector` generated column not yet applied — run `npx prisma migrate dev --name add_search_vector --create-only` and hand-edit the migration with `ALTER TABLE worker_profiles ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(full_name, '') || ' ' || coalesce(bio, '') || ' ' || coalesce(array_to_string(skills, ' '), ''))) STORED` + `CREATE INDEX worker_search_idx ON worker_profiles USING GIN (search_vector)` when ready
- Build passes: `npm run build` ✅
- **Before running:** run `npx prisma migrate dev --name add_verification_availability`

### Phase 3 — Users, Profiles & Storage (2026-06-30)
- Installed: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
- Updated `prisma/schema.prisma` — added `WorkerType` enum, `VerificationStatus` enum, `ClientProfile` model, `WorkerProfile` model, relations on `User`; regenerated client
- Created `src/infrastructure/storage/storage.service.ts` — presigned upload (5 min, 5MB, MIME validation), presigned download (7 days), `buildKey`
- Created `src/infrastructure/storage/storage.module.ts` — `@Global()`
- Created `src/modules/users/dto/update-user.dto.ts`, `avatar-upload.dto.ts`
- Created `src/modules/users/users.service.ts` — select-safe `findById`, `update`
- Created `src/modules/users/users.controller.ts` — `GET/PATCH /users/me`, `POST /users/me/avatar`
- Created `src/modules/users/users.module.ts` — exports `UsersService`
- Created `src/modules/profiles/dto/` — `create-client-profile.dto.ts`, `create-worker-profile.dto.ts` (`@ValidateIf` for HS fields, `hourlyRate` in Naira), `update-worker-profile.dto.ts`, `update-client-profile.dto.ts`
- Created `src/modules/profiles/profiles.service.ts` — `upsertWorkerProfile` (Naira → kobo), `upsertClientProfile`, `patchWorkerProfile`, `patchClientProfile`, `getOwnProfile`, `getPublicWorkerProfile` (excludes `institution`/`gradYear`)
- Created `src/modules/profiles/profiles.controller.ts` — `GET/PUT/PATCH /users/me/profile`, `GET /users/:id/profile` (CLIENT only; `me/*` declared before `:id/*`)
- Created `src/modules/profiles/profiles.module.ts`
- Updated `app.module.ts` — added `StorageModule`, `UsersModule`, `ProfilesModule`
- Note: `PUT/PATCH /users/me/profile` body uses `Record<string, unknown>` (polymorphic); cast through `unknown` before passing to service
- Build passes: `npm run build` ✅
- **Before running:** run `npx prisma migrate dev --name add_profiles`

### Phase 2 — Auth Module (2026-06-30)
- Installed: `@nestjs/bullmq`, `@nestjs/passport`, `passport`, `passport-jwt`, `@nestjs/jwt`, `passport-google-oauth20`, `bcrypt`, `cookie-parser` + types
- Updated `prisma/schema.prisma` — added `Role` enum, `UserStatus` enum, `User` model, `RefreshToken` model; regenerated client
- Created `src/common/types/jwt-payload.type.ts`
- Created `src/common/decorators/` — `public.decorator.ts`, `roles.decorator.ts`, `current-user.decorator.ts`
- Created `src/common/guards/` — `jwt-auth.guard.ts` (global, skips `@Public()`), `roles.guard.ts`
- Created `src/modules/auth/dto/` — `register.dto.ts`, `login.dto.ts`, `verify-otp.dto.ts`, `resend-otp.dto.ts`, `reset-password.dto.ts`
- Created `src/modules/auth/strategies/jwt.strategy.ts` — RS256, checks `revoked:{jti}` in Redis
- Created `src/modules/auth/strategies/google.strategy.ts` — Google OAuth 2.0
- Created `src/modules/auth/auth.service.ts` — register, OTP flow, login (brute-force lock), refresh rotation, logout, Google login, password reset
- Created `src/modules/auth/auth.controller.ts` — all 10 auth endpoints
- Created `src/modules/auth/auth.module.ts`
- Updated `app.module.ts` — added `BullModule.forRoot` (Redis), `AuthModule`, and global `ThrottlerGuard`, `JwtAuthGuard`, `RolesGuard` via `APP_GUARD` (in order: throttler → jwt → roles)
- Updated `main.ts` — added `cookieParser()` middleware
- Note: `import type { Request, Response }` required in controller due to `isolatedModules + emitDecoratorMetadata`
- Build passes: `npm run build` ✅
- **Before running:** fill in real `.env` values and run `npx prisma migrate dev --name auth`

### Phase 1 — Scaffold & Infrastructure (2026-06-30)
- Installed all packages: `@prisma/client@^6`, `prisma@^6`, `ioredis`, `@nestjs/throttler`, `bullmq`, `helmet`, `compression`, `@nestjs/swagger`, `@nestjs/event-emitter`, `eventemitter2`, `pino-http`, `nestjs-pino`, `pino-pretty`, `@nest-lab/throttler-storage-redis`, `class-validator`, `class-transformer`
- Enabled strict TypeScript (`strict`, `noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`)
- Created `prisma/schema.prisma` with HealthCheck model and Neon connection config
- Created `.env` with placeholder values for all required environment variables
- Created `src/infrastructure/prisma/` — `PrismaService` and global `PrismaModule`
- Created `src/infrastructure/redis/` — `RedisService` and global `RedisModule`
- Created `src/common/filters/` — `HttpExceptionFilter`, `PrismaExceptionFilter`
- Created `src/common/interceptors/` — `BigIntSerializerInterceptor`, `ResponseTransformInterceptor`
- Updated `app.module.ts` — imports `LoggerModule`, `EventEmitterModule`, `ThrottlerModule` (Redis storage), `PrismaModule`, `RedisModule`
- Updated `main.ts` — Helmet, compression, CORS whitelist, `ValidationPipe`, global filters/interceptors, `api/v1` prefix, Swagger (dev only)
- Deleted generated placeholder: `app.controller.ts`, `app.service.ts`, `app.controller.spec.ts`
- Note: Downgraded to `prisma@6` (Prisma 7 dropped `url` in schema.prisma — v6 matches the project spec)
- Build passes: `npm run build` ✅