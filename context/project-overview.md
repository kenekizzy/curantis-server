# CareGiverNG — Backend API

> NestJS · PostgreSQL (Neon) · Prisma ORM · Redis · BullMQ · Socket.io

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Tech Stack](#-tech-stack)
- [Architecture](#-architecture)
- [Project Structure](#-project-structure)
- [Module Design](#-module-design)
- [Database](#-database)
- [Authentication & Security](#-authentication--security)
- [In-App Chat Flow](#-in-app-chat-flow)
- [Queue Architecture](#-queue-architecture)
- [API Conventions](#-api-conventions)
- [Environment & Config](#-environment--config)
- [Development Notes](#-development-notes)

---

## 🎯 Overview

The CareGiverNG backend is a **NestJS modular monolith** that serves three separate frontend applications:

| Consumer              | Base path            | Auth required |
| --------------------- | -------------------- | :-----------: |
| Client (Next.js)      | `/api/v1/*`          | JWT           |
| Worker (Next.js)      | `/api/v1/*`          | JWT           |
| Admin (Angular)       | `/api/v1/admin/*`    | JWT + Role    |
| Payment gateways      | `/api/v1/webhooks/*` | HMAC sig      |
| WebSocket (all)       | `/socket.io`         | JWT handshake |

---

## 🛠️ Tech Stack

| Category             | Technology                     | Notes                                          |
| -------------------- | ------------------------------ | ---------------------------------------------- |
| **Framework**        | NestJS 11                      | Modular monolith; decorator-based architecture |
| **Language**         | TypeScript 5.5+                | Strict mode; no `any`                          |
| **Database**         | PostgreSQL 16 via Neon         | Serverless Postgres; connection pooling        |
| **ORM**              | Prisma 6                       | Migrations-only workflow; typed client         |
| **Cache**            | Redis 7+ (Upstash or self-hosted) | Rate limiting, session cache, presence       |
| **Job Queue**        | BullMQ                         | Notifications, payouts, refunds, cron jobs     |
| **Real-time**        | Socket.io 4 (`@nestjs/websockets`) | Chat, live queue updates, presence          |
| **Auth**             | Passport.js (JWT + Google)     | RS256 JWT; refresh token rotation              |
| **Validation**       | class-validator + class-transformer | DTO validation on every endpoint          |
| **File Storage**     | Cloudinary                     | Signed direct uploads; profile photos, documents, chat attachments |
| **Payments**         | Paystack + Flutterwave SDK     | HMAC webhook verification on both             |
| **Email**            | Resend (via BullMQ queue)      | Never synchronous; always queued              |
| **SMS / OTP**        | Termii                         | Nigerian SMS delivery; 60s OTP TTL            |
| **Testing**          | Jest + Supertest               | Unit (services) + e2e (API routes)            |
| **Documentation**    | Swagger / OpenAPI (`@nestjs/swagger`) | Auto-generated; dev + staging only   |
| **Process manager**  | PM2 (production)               | Cluster mode; zero-downtime reload            |

---

## 🏗️ Architecture

```mermaid
flowchart TB
    subgraph Clients["Clients"]
        ClientApp["Client Next.js"]
        WorkerApp["Worker Next.js"]
        AdminApp["Admin Angular"]
        Gateways["Payment Gateways (webhooks)"]
    end

    subgraph NestJS["NestJS Application"]
        GlobalMiddleware["Global: Helmet, CORS, Compression, Logger"]
        Guards["Global Guards: JwtAuthGuard, RolesGuard, ThrottlerGuard"]

        subgraph Modules["Feature Modules"]
            Auth["AuthModule"]
            Users["UsersModule"]
            Profiles["ProfilesModule"]
            Verification["VerificationModule"]
            Workers["WorkersModule (search)"]
            Availability["AvailabilityModule"]
            Bookings["BookingsModule"]
            Payments["PaymentsModule"]
            Reviews["ReviewsModule"]
            Reports["ReportsModule"]
            Chat["ChatModule"]
            Notifications["NotificationsModule"]
            Admin["AdminModule"]
            Analytics["AnalyticsModule"]
        end

        subgraph Infrastructure["Infrastructure Modules"]
            PrismaModule["PrismaModule"]
            RedisModule["RedisModule"]
            QueueModule["QueueModule (BullMQ)"]
            StorageModule["StorageModule (Cloudinary)"]
            SocketGateway["SocketGateway"]
        end
    end

    subgraph External["External"]
        Neon["Neon PostgreSQL"]
        Redis["Redis"]
        Cloudinary["Cloudinary"]
        Paystack["Paystack"]
        Flutterwave["Flutterwave"]
        Resend["Resend (email)"]
        Termii["Termii (SMS)"]
        OpenAI["OpenAI"]
    end

    Clients --> NestJS
    PrismaModule --> Neon
    RedisModule --> Redis
    StorageModule --> Cloudinary
    Payments --> Paystack
    Payments --> Flutterwave
    QueueModule --> Resend
    QueueModule --> Termii
    QueueModule --> OpenAI
```

---

## 📁 Project Structure

```
caregiverng-backend/
├── src/
│   │
│   ├── main.ts                              # Bootstrap; Helmet, CORS, pipes, Swagger
│   ├── app.module.ts                        # Root module; imports all feature + infra modules
│   │
│   ├── config/                              # Configuration (validated with Joi)
│   │   ├── app.config.ts
│   │   ├── database.config.ts
│   │   ├── redis.config.ts
│   │   ├── jwt.config.ts
│   │   ├── s3.config.ts
│   │   ├── paystack.config.ts
│   │   └── openai.config.ts
│   │
│   ├── common/                              # Shared across all modules
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts    # @CurrentUser() → JwtPayload
│   │   │   ├── roles.decorator.ts           # @Roles(Role.ADMIN)
│   │   │   └── public.decorator.ts          # @Public() — skip JWT guard
│   │   │
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts            # Global guard; skips @Public()
│   │   │   ├── roles.guard.ts               # Checks role claim from JWT
│   │   │   └── ws-auth.guard.ts             # WebSocket JWT verification
│   │   │
│   │   ├── interceptors/
│   │   │   ├── response-transform.interceptor.ts   # Wrap all responses in { success, data, meta }
│   │   │   ├── logging.interceptor.ts
│   │   │   └── timeout.interceptor.ts
│   │   │
│   │   ├── filters/
│   │   │   ├── http-exception.filter.ts     # Standardise all error responses
│   │   │   └── prisma-exception.filter.ts   # Map Prisma errors to HTTP codes
│   │   │
│   │   ├── pipes/
│   │   │   └── parse-bigint.pipe.ts         # Convert kobo string params to BigInt
│   │   │
│   │   ├── dto/
│   │   │   └── pagination.dto.ts            # Cursor + offset pagination base DTO
│   │   │
│   │   └── types/
│   │       ├── jwt-payload.type.ts
│   │       ├── api-response.type.ts
│   │       └── role.enum.ts
│   │
│   ├── infrastructure/                      # Framework-level modules
│   │   │
│   │   ├── prisma/
│   │   │   ├── prisma.module.ts             # Global module
│   │   │   └── prisma.service.ts            # PrismaClient singleton + onModuleInit
│   │   │
│   │   ├── redis/
│   │   │   ├── redis.module.ts              # Global module; ioredis provider
│   │   │   └── redis.service.ts
│   │   │
│   │   ├── queue/
│   │   │   ├── queue.module.ts              # BullMQ module; registers all queues
│   │   │   ├── queues.constants.ts          # Queue name constants
│   │   │   └── processors/
│   │   │       ├── notification.processor.ts  # email + SMS dispatch
│   │   │       ├── payout.processor.ts        # escrow release + retry
│   │   │       ├── refund.processor.ts        # refund + retry
│   │   │       ├── verification.processor.ts  # NIN lookup + reminders
│   │   │       └── cleanup.processor.ts       # purge expired tokens (cron)
│   │   │
│   │   ├── storage/
│   │   │   ├── storage.module.ts
│   │   │   └── storage.service.ts           # Cloudinary signed upload params
│   │   │
│   │   └── socket/
│   │       ├── socket.module.ts
│   │       ├── socket.gateway.ts            # @WebSocketGateway — all real-time events
│   │       └── socket.service.ts            # Emit helpers for use from other modules
│   │
│   └── modules/
│       │
│       ├── auth/
│       │   ├── auth.module.ts
│       │   ├── auth.controller.ts
│       │   ├── auth.service.ts
│       │   ├── strategies/
│       │   │   ├── jwt.strategy.ts          # Validates access token
│       │   │   ├── jwt-refresh.strategy.ts  # Validates refresh token cookie
│       │   │   └── google.strategy.ts       # Google OAuth callback
│       │   └── dto/
│       │       ├── register.dto.ts
│       │       ├── login.dto.ts
│       │       └── refresh.dto.ts
│       │
│       ├── users/
│       │   ├── users.module.ts
│       │   ├── users.controller.ts
│       │   ├── users.service.ts
│       │   └── dto/
│       │       ├── create-user.dto.ts
│       │       └── update-user.dto.ts
│       │
│       ├── profiles/
│       │   ├── profiles.module.ts
│       │   ├── profiles.controller.ts
│       │   ├── profiles.service.ts
│       │   └── dto/
│       │       ├── create-client-profile.dto.ts
│       │       ├── create-worker-profile.dto.ts
│       │       └── update-worker-profile.dto.ts
│       │
│       ├── verification/
│       │   ├── verification.module.ts
│       │   ├── verification.controller.ts
│       │   ├── verification.service.ts
│       │   └── dto/
│       │       ├── submit-identity.dto.ts
│       │       └── submit-credential.dto.ts
│       │
│       ├── workers/
│       │   ├── workers.module.ts
│       │   ├── workers.controller.ts        # Public search + profile view
│       │   ├── workers.service.ts
│       │   └── dto/
│       │       └── search-workers.dto.ts
│       │
│       ├── availability/
│       │   ├── availability.module.ts
│       │   ├── availability.controller.ts
│       │   ├── availability.service.ts
│       │   └── dto/
│       │       ├── set-schedule.dto.ts
│       │       └── add-block.dto.ts
│       │
│       ├── bookings/
│       │   ├── bookings.module.ts
│       │   ├── bookings.controller.ts
│       │   ├── bookings.service.ts
│       │   ├── booking-lifecycle.service.ts # start, complete, auto-complete cron
│       │   └── dto/
│       │       ├── create-booking.dto.ts
│       │       ├── accept-booking.dto.ts
│       │       └── cancel-booking.dto.ts
│       │
│       ├── payments/
│       │   ├── payments.module.ts
│       │   ├── payments.controller.ts
│       │   ├── payments.service.ts
│       │   ├── escrow.service.ts            # Release logic, dispute hold
│       │   ├── webhooks/
│       │   │   ├── paystack.webhook.ts
│       │   │   └── flutterwave.webhook.ts
│       │   └── dto/
│       │       ├── initiate-payment.dto.ts
│       │       └── refund.dto.ts
│       │
│       ├── reviews/
│       │   ├── reviews.module.ts
│       │   ├── reviews.controller.ts
│       │   ├── reviews.service.ts
│       │   └── dto/
│       │       ├── create-review.dto.ts
│       │       └── update-review.dto.ts
│       │
│       ├── reports/
│       │   ├── reports.module.ts
│       │   ├── reports.controller.ts
│       │   ├── reports.service.ts
│       │   └── dto/
│       │       └── create-report.dto.ts
│       │
│       ├── chat/
│       │   ├── chat.module.ts
│       │   ├── chat.controller.ts           # REST: history, file upload
│       │   ├── chat.service.ts              # Message persistence
│       │   └── dto/
│       │       └── send-message.dto.ts
│       │
│       ├── notifications/
│       │   ├── notifications.module.ts
│       │   ├── notifications.controller.ts
│       │   └── notifications.service.ts
│       │
│       └── admin/
│           ├── admin.module.ts
│           ├── controllers/
│           │   ├── admin-users.controller.ts
│           │   ├── admin-verifications.controller.ts
│           │   ├── admin-bookings.controller.ts
│           │   ├── admin-payments.controller.ts
│           │   ├── admin-reviews.controller.ts
│           │   ├── admin-reports.controller.ts
│           │   └── admin-analytics.controller.ts
│           ├── services/
│           │   ├── admin-users.service.ts
│           │   ├── admin-verifications.service.ts
│           │   ├── admin-payments.service.ts
│           │   └── admin-analytics.service.ts
│           └── dto/
│               ├── approve-verification.dto.ts
│               ├── resolve-dispute.dto.ts
│               └── issue-refund.dto.ts
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
│
├── test/
│   ├── auth.e2e-spec.ts
│   ├── bookings.e2e-spec.ts
│   └── payments.e2e-spec.ts
│
├── nest-cli.json
├── tsconfig.json
├── package.json
└── .env
```

---

## 🧩 Module Design

### Event bus pattern (decoupled side effects)

```typescript
// Modules communicate via EventEmitter2 — never circular service injection

// bookings/booking-lifecycle.service.ts
async completeBooking(bookingId: string, workerId: string): Promise<void> {
  await this.prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: 'COMPLETED',
      actualEnd: new Date(),
      escrowReleaseAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  // Emit — PaymentsModule and NotificationsModule listen independently
  this.eventEmitter.emit('booking.completed', {
    bookingId,
    workerId,
    clientId: booking.clientId,
    workerAmountKobo: booking.workerAmountKobo,
  });
}

// payments/escrow.service.ts
@OnEvent('booking.completed')
async scheduleEscrowRelease({ bookingId, workerAmountKobo }: BookingCompletedEvent) {
  await this.payoutsQueue.add(
    'release-escrow',
    { bookingId, workerAmountKobo },
    { delay: 86_400_000 }  // 24 hours
  );
}

// notifications/notifications.service.ts
@OnEvent('booking.completed')
async notifyBookingComplete({ bookingId, workerId, clientId }: BookingCompletedEvent) {
  await this.notifQueue.addBulk([
    { name: 'send', data: { userId: clientId, type: 'BOOKING_COMPLETE', bookingId } },
    { name: 'send', data: { userId: workerId, type: 'BOOKING_COMPLETE', bookingId } },
  ]);
}
```

### Response transform interceptor

```typescript
// common/interceptors/response-transform.interceptor.ts
@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map(data => ({
        success: true,
        data:    data?.data ?? data,
        meta:    data?.meta ?? undefined,
      }))
    );
  }
}
```

### Prisma exception filter

```typescript
// common/filters/prisma-exception.filter.ts
@Catch(PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx    = host.switchToHttp();
    const res    = ctx.getResponse<Response>();

    const statusMap: Record<string, number> = {
      P2002: 409,   // Unique constraint violation
      P2025: 404,   // Record not found
      P2003: 400,   // Foreign key constraint
    };

    const status  = statusMap[exception.code] ?? 500;
    const message = status === 409 ? 'Resource already exists' : 'Database error';

    res.status(status).json({ success: false, error: { code: `DB_${exception.code}`, message } });
  }
}
```

---

## 🗄️ Database

### Key Prisma patterns

```prisma
// prisma/schema.prisma

// ⚠️ NEVER use prisma db push in any environment
// Always: npx prisma migrate dev --name <name>
//         npx prisma migrate deploy  (production)

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")        // Neon: use direct URL for migrations
}
```

### Connection pooling with Neon

```typescript
// infrastructure/prisma/prisma.service.ts
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
      datasources: {
        db: {
          url: process.env.DATABASE_URL,  // pooled URL (port 6543)
        },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
```

> ⚠️ **Neon URL pattern**
>
> Neon provides two connection strings:
> - `DATABASE_URL` — **pooled** connection (port 6543) → use for all app queries
> - `DIRECT_URL` — **direct** connection (port 5432) → use for Prisma migrations only
>
> ```env
> DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech:6543/neondb?pgbouncer=true"
> DIRECT_URL="postgresql://user:pass@ep-xxx.neon.tech:5432/neondb"
> ```

### Monetary values — critical rule

```typescript
// ✅ Always store in kobo (BigInt)
const totalAmountKobo = BigInt(Math.round(hourlyRate * durationHours * 100));

// ✅ Prisma returns BigInt — serialize to string for JSON
// In main.ts bootstrap:
app.useGlobalInterceptors(new BigIntSerializerInterceptor());

// common/interceptors/bigint-serializer.interceptor.ts
// Uses JSON.stringify replacer to convert BigInt → string
```

---

## 🔐 Authentication & Security

### JWT strategy

```typescript
// modules/auth/strategies/jwt.strategy.ts
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey:    configService.get<string>('JWT_PUBLIC_KEY'),  // RS256 public key
      algorithms:     ['RS256'],
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    // Check jti not in revoked set (Redis)
    const revoked = await this.redis.get(`revoked:${payload.jti}`);
    if (revoked) throw new UnauthorizedException('Token revoked');
    return payload;
  }
}
```

### OTP flow

```typescript
// modules/auth/auth.service.ts
async sendOtp(identifier: string): Promise<void> {
  const otp  = crypto.randomInt(100000, 999999).toString();
  const key  = `otp:${identifier}`;

  // Store hash — never raw OTP — with 10 min TTL
  const hash = await bcrypt.hash(otp, 10);
  await this.redis.setex(key, 600, hash);

  // Queue SMS (never synchronous)
  await this.notifQueue.add('send-otp-sms', { phone: identifier, otp });
}

async verifyOtp(identifier: string, code: string): Promise<boolean> {
  const hash = await this.redis.get(`otp:${identifier}`);
  if (!hash) return false;
  const valid = await bcrypt.compare(code, hash);
  if (valid) await this.redis.del(`otp:${identifier}`);
  return valid;
}
```

### Rate limiting

```typescript
// app.module.ts
ThrottlerModule.forRoot({
  throttlers: [
    { name: 'short',  ttl: 60_000,   limit: 10  },   // 10/min — login
    { name: 'medium', ttl: 600_000,  limit: 3   },   // 3/10min — OTP
    { name: 'long',   ttl: 60_000,   limit: 120 },   // 120/min — general
  ],
  storage: new ThrottlerStorageRedisService(redisClient),
})
```

---

## 💬 In-App Chat Flow

### Socket Gateway

```typescript
// infrastructure/socket/socket.gateway.ts
@WebSocketGateway({
  cors: { origin: [process.env.CLIENT_URL, process.env.WORKER_URL, process.env.ADMIN_URL] },
  namespace: '/chat',
})
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect {

  @WebSocketServer() server: Server;

  // ── Connection ────────────────────────────────────────────────
  async handleConnection(client: AuthenticatedSocket) {
    const token = client.handshake.auth?.token;
    const payload = this.authService.verifyAccessToken(token);
    if (!payload) { client.disconnect(); return; }

    client.data.userId = payload.sub;
    client.data.role   = payload.role;

    // Join personal room for directed messages
    client.join(`user:${payload.sub}`);

    // Mark online in Redis (TTL 90s — heartbeat refreshes it)
    await this.redis.setex(`presence:${payload.sub}`, 90, 'online');

    // Broadcast presence to relevant conversations
    this.server.emit('chat:presence', { userId: payload.sub, status: 'online' });
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    if (!client.data.userId) return;
    await this.redis.del(`presence:${client.data.userId}`);
    this.server.emit('chat:presence', { userId: client.data.userId, status: 'offline' });
  }

  // ── Join conversation room ────────────────────────────────────
  @SubscribeMessage('chat:join')
  async handleJoin(client: AuthenticatedSocket, { conversationId }: JoinDto) {
    // Verify user belongs to this conversation
    const allowed = await this.chatService.canAccess(client.data.userId, conversationId);
    if (!allowed) return { error: 'FORBIDDEN' };

    client.join(`conv:${conversationId}`);

    // Load and return last 50 messages
    const messages = await this.chatService.getHistory(conversationId, 50);
    client.emit('chat:history', { messages });

    // Mark messages as read
    await this.chatService.markRead(conversationId, client.data.userId);
  }

  // ── Send message ─────────────────────────────────────────────
  @SubscribeMessage('chat:send')
  async handleMessage(client: AuthenticatedSocket, dto: SendMessageDto) {
    const allowed = await this.chatService.canAccess(client.data.userId, dto.conversationId);
    if (!allowed) return { error: 'FORBIDDEN' };

    const message = await this.chatService.persistMessage({
      conversationId: dto.conversationId,
      senderId:       client.data.userId,
      text:           dto.text,
      fileUrl:        dto.fileUrl,
      fileType:       dto.fileType,
      fileName:       dto.fileName,
    });

    // Broadcast to room (includes sender — for multi-device sync)
    this.server
      .to(`conv:${dto.conversationId}`)
      .emit('chat:message', { message });

    // Ack back to sender
    client.emit('chat:message:ack', { messageId: message.id, sentAt: message.createdAt });

    // Queue push notification for offline recipient
    await this.notifQueue.add('chat-push', {
      conversationId:  dto.conversationId,
      senderId:        client.data.userId,
      recipientId:     message.recipientId,
      preview:         dto.text ? dto.text.slice(0, 60) : '📎 Attachment',
    });
  }

  // ── Typing indicator ─────────────────────────────────────────
  @SubscribeMessage('chat:typing')
  async handleTyping(client: AuthenticatedSocket, { conversationId }: TypingDto) {
    client
      .to(`conv:${conversationId}`)
      .emit('chat:typing', {
        userId:         client.data.userId,
        conversationId,
      });

    // Auto-clear: client should stop emitting after 3s of no keystrokes
  }

  // ── Read receipt ─────────────────────────────────────────────
  @SubscribeMessage('chat:read')
  async handleRead(client: AuthenticatedSocket, { conversationId, lastReadAt }: ReadDto) {
    await this.chatService.markRead(conversationId, client.data.userId, lastReadAt);

    client
      .to(`conv:${conversationId}`)
      .emit('chat:read', {
        userId:         client.data.userId,
        conversationId,
        lastReadAt,
      });
  }

  // ── Presence heartbeat ────────────────────────────────────────
  @SubscribeMessage('chat:heartbeat')
  async handleHeartbeat(client: AuthenticatedSocket) {
    await this.redis.setex(`presence:${client.data.userId}`, 90, 'online');
  }
}
```

### Chat database schema

```prisma
// In prisma/schema.prisma

model Conversation {
  id            String    @id @default(cuid())
  bookingId     String?   @unique         // linked booking (if support context)
  participantA  String                    // userId
  participantB  String                    // userId
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  messages      Message[]

  @@index([participantA, participantB])
  @@map("conversations")
}

model Message {
  id              String    @id @default(cuid())
  conversationId  String
  senderId        String
  text            String?   @db.Text
  fileUrl         String?
  fileName        String?
  fileSize        Int?
  fileType        String?   // 'image' | 'document' | 'audio'
  readAt          DateTime?
  createdAt       DateTime  @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt])
  @@map("messages")
}
```

### File upload flow (chat attachments)

```
1. Client calls: POST /api/v1/chat/upload  { conversationId, mimeType, fileSize, filename }
2. Server validates MIME type + size (max 10MB for chat attachments) and returns
   Cloudinary signed upload params: { uploadUrl, signature, timestamp, apiKey, cloudName, folder, publicId, resourceType }
3. Client uploads the file directly to Cloudinary's `uploadUrl` (multipart/form-data,
   including the signed params) — the server never touches the file bytes
4. Cloudinary's own upload response gives the client the final `secure_url`
5. Client emits: chat:send with { conversationId, fileUrl: secure_url, fileType, fileName }
6. Server persists the message with fileUrl
7. Recipients receive chat:message with fileUrl for inline preview
```

---

## ⚙️ Queue Architecture

```typescript
// infrastructure/queue/queues.constants.ts
export const QUEUES = {
  NOTIFICATIONS: 'notifications',
  PAYOUTS:       'payouts',
  REFUNDS:       'refunds',
  VERIFICATION:  'verification',
  CLEANUP:       'cleanup',
  CHAT:          'chat',
} as const;
```

| Queue             | Jobs                                         | Concurrency | Retry Policy              |
| ----------------- | -------------------------------------------- | :---------: | ------------------------- |
| `notifications`   | `send-email`, `send-sms`, `send-otp-sms`     | 10          | 3 retries, exp backoff    |
| `payouts`         | `release-escrow`, `retry-payout`             | 2           | 3 retries, 1hr delay      |
| `refunds`         | `process-refund`, `retry-refund`             | 2           | 3 retries, 1hr delay      |
| `verification`    | `nin-lookup`, `credential-expiry-reminder`   | 5           | 2 retries                 |
| `cleanup`         | `purge-refresh-tokens`, `purge-otp` (cron)   | 1           | No retry — cron re-runs   |
| `chat`            | `chat-push` (offline push notifications)     | 10          | 2 retries                 |

---

## 📡 API Conventions

### Base URL

```
Development:  http://localhost:3000/api/v1
Staging:      https://api-staging.caregiverng.com/api/v1
Production:   https://api.caregiverng.com/api/v1
```

### Response envelope

```typescript
// Success
{ success: true,  data: T,       meta?: PaginationMeta }

// Error
{ success: false, error: { code: string, message: string, details?: any[] } }
```

### Error code catalogue

| Code                       | HTTP | Description                                |
| -------------------------- | :--: | ------------------------------------------ |
| `AUTH_INVALID_CREDENTIALS` | 401  | Wrong email/password                       |
| `AUTH_ACCOUNT_LOCKED`      | 403  | Too many failed attempts                   |
| `AUTH_TOKEN_EXPIRED`       | 401  | JWT access token expired                   |
| `AUTH_INSUFFICIENT_ROLE`   | 403  | Role does not have permission              |
| `USER_SUSPENDED`           | 403  | Account is suspended                       |
| `VERIFICATION_PENDING`     | 403  | Worker not verified — cannot accept jobs   |
| `BOOKING_CONFLICT`         | 409  | Time slot no longer available              |
| `BOOKING_INVALID_STATUS`   | 422  | Action not permitted for current status    |
| `PAYMENT_FAILED`           | 402  | Gateway declined transaction               |
| `PAYMENT_DUPLICATE`        | 409  | Duplicate gateway transaction detected     |
| `STUDENT_RESTRICTED`       | 403  | HS cannot accept regulated service         |
| `RATE_LIMIT_EXCEEDED`      | 429  | Too many requests                          |

---

## ⚙️ Environment & Config

```env
# .env

# App
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000
CLIENT_URL=http://localhost:3001
WORKER_URL=http://localhost:3002
ADMIN_URL=http://localhost:4200

# Database (Neon)
DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech:6543/neondb?pgbouncer=true"
DIRECT_URL="postgresql://user:pass@ep-xxx.neon.tech:5432/neondb"

# Redis
REDIS_URL=redis://localhost:6379

# JWT (RS256 — generate with openssl)
JWT_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n..."
JWT_ACCESS_EXPIRY=900            # 15 minutes
JWT_REFRESH_EXPIRY=2592000       # 30 days

# Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3000/api/v1/auth/google/callback

# Payments
PAYSTACK_SECRET_KEY=sk_test_...
PAYSTACK_WEBHOOK_SECRET=...
FLUTTERWAVE_SECRET_KEY=FLWSECK_TEST-...
FLUTTERWAVE_WEBHOOK_HASH=...

# Cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# Email
RESEND_API_KEY=re_...

# SMS
TERMII_API_KEY=
TERMII_SENDER_ID=CareGiverNG

# OpenAI
OPENAI_API_KEY=sk-...
```

---

## 🔧 Development Notes

> ⚠️ **Never use `prisma db push`**
> Always use `npx prisma migrate dev --name <name>` in development.
> Production: `npx prisma migrate deploy` in the CI/CD pipeline.

> ⚠️ **BigInt serialization**
> Prisma returns `BigInt` for `BigInt` columns. Express/Fastify cannot serialize BigInt to JSON by default.
> Register the `BigIntSerializerInterceptor` globally in `main.ts`.

> ⚠️ **Webhook HMAC verification**
> Paystack and Flutterwave webhooks must be verified **before** any business logic runs.
> Use `rawBody` middleware — `bodyParser` must be configured to preserve raw bytes on webhook routes.

> ⚠️ **Event emitter in tests**
> When unit testing services that emit events, mock `EventEmitter2` to prevent side effects firing during test runs.

---

## 🚀 Next Steps

1. [ ] Scaffold NestJS project (`nest new caregiverng-backend`)
2. [ ] Configure Prisma with Neon (pooled + direct URLs)
3. [ ] Set up global pipes, interceptors, filters, and Swagger
4. [ ] Implement AuthModule (JWT RS256, OTP, Google OAuth, refresh rotation)
5. [ ] Build UsersModule and ProfilesModule
6. [ ] Build VerificationModule with S3 upload
7. [ ] Build WorkersModule (Postgres FTS search)
8. [ ] Build AvailabilityModule
9. [ ] Build BookingsModule with full lifecycle + EventEmitter2
10. [ ] Build PaymentsModule (Paystack + Flutterwave + escrow + webhooks)
11. [ ] Set up BullMQ queues and processors
12. [ ] Implement Socket.io gateway (chat + presence + live queue)
13. [ ] Build ChatModule (persistence + file upload)
14. [ ] Build AdminModule (all admin API surfaces)
15. [ ] Write e2e tests for critical paths (auth, booking, payment)
16. [ ] Configure PM2 for production cluster mode
17. [ ] Deploy to production with CI/CD migration pipeline

---

*Last updated: June 2026*