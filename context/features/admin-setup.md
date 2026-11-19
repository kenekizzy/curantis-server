# Phase 8 — Admin Module + Socket.io

> AdminModule (all sub-controllers) · Admin sub-roles · Socket.io gateway · ChatModule
> **Estimated time:** ~3 days · Last phase — wraps everything built so far

---

## 📋 Table of Contents

- [Goal](#-goal)
- [Step 1 — AdminModule Structure](#-step-1--adminmodule-structure)
- [Step 2 — Admin Sub-Roles](#-step-2--admin-sub-roles)
- [Step 3 — Admin Sub-Controllers](#-step-3--admin-sub-controllers)
- [Step 4 — Socket.io Gateway](#-step-4--socketio-gateway)
- [Step 5 — ChatModule](#-step-5--chatmodule)
- [Admin Audit Logging](#-admin-audit-logging)
- [API Reference](#-api-reference)
- [Verification Checklist](#-verification-checklist)
- [Common Pitfalls](#-common-pitfalls)

---

## 🎯 Goal

The admin module is intentionally last because it creates almost no new business logic — it exposes controlled read/write access to data and workflows that already exist from Phases 2–7. Every admin action must be logged immutably, every admin route must independently verify both the `ADMIN` role and the specific sub-role required for that action, and the Socket.io layer built here powers both the support chat and the live notification feed admins rely on.

---

## 🗄️ Schema

```prisma
// prisma/schema.prisma

enum AdminRole {
  SUPER_ADMIN
  VERIFICATION_OFFICER
  SUPPORT_AGENT
  FINANCE_OFFICER
}

model AdminProfile {
  id        String    @id @default(cuid())
  userId    String    @unique
  adminRole AdminRole
  createdAt DateTime  @default(now())

  @@map("admin_profiles")
}

model AdminLog {
  id         String   @id @default(cuid())
  adminId    String
  action     String
  targetType String
  targetId   String
  reason     String?
  metadata   Json?
  createdAt  DateTime @default(now())

  @@index([adminId, createdAt])
  @@map("admin_logs")
}

model Conversation {
  id           String    @id @default(cuid())
  bookingId    String?   @unique
  participantA String
  participantB String
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  messages Message[]

  @@index([participantA, participantB])
  @@map("conversations")
}

model Message {
  id             String    @id @default(cuid())
  conversationId String
  senderId       String
  text           String?   @db.Text
  fileUrl        String?
  fileName       String?
  fileSize       Int?
  fileType       String?
  readAt         DateTime?
  createdAt      DateTime  @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId, createdAt])
  @@map("messages")
}
```

```bash
npx prisma migrate dev --name add_admin_and_chat
pnpm add @nestjs/websockets @nestjs/platform-socket.io socket.io
```

---

## 🏛️ Step 1 — AdminModule Structure

All admin routes live under a single prefix, enforced at the controller level — not per-route — so it's structurally impossible to forget the guard on a new endpoint.

```typescript
// src/modules/admin/admin.module.ts
import { Module } from '@nestjs/common';
import { AdminUsersController } from './controllers/admin-users.controller';
import { AdminVerificationsController } from './controllers/admin-verifications.controller';
import { AdminBookingsController } from './controllers/admin-bookings.controller';
import { AdminPaymentsController } from './controllers/admin-payments.controller';
import { AdminReviewsController } from './controllers/admin-reviews.controller';
import { AdminReportsController } from './controllers/admin-reports.controller';
import { AdminAnalyticsController } from './controllers/admin-analytics.controller';
import { AdminLoggerService } from './services/admin-logger.service';

@Module({
  controllers: [
    AdminUsersController,
    AdminVerificationsController,
    AdminBookingsController,
    AdminPaymentsController,
    AdminReviewsController,
    AdminReportsController,
    AdminAnalyticsController,
  ],
  providers: [AdminLoggerService],
})
export class AdminModule {}
```

```typescript
// src/modules/admin/controllers/admin-users.controller.ts
import { Controller, Get, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator';

@UseGuards() // JwtAuthGuard + RolesGuard already global — this just documents intent
@Roles('ADMIN')
@Controller('admin/users')
export class AdminUsersController {
  // every method here is automatically behind role=ADMIN
}
```

> ⚠️ **Apply `@Roles('ADMIN')` at the controller class level, not on individual methods.** Decorating the class means every current and future endpoint in that controller is protected by default — a developer adding a new route later cannot accidentally forget the guard.

---

## 🎭 Step 2 — Admin Sub-Roles

Beyond the base `ADMIN` role check (which gates access to `/admin/*` at all), specific destructive actions require a specific sub-role.

```typescript
// src/common/decorators/admin-role.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { AdminRole } from '@prisma/client';

export const ADMIN_ROLES_KEY = 'adminRoles';
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ADMIN_ROLES_KEY, roles);
```

```typescript
// src/common/guards/admin-roles.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ADMIN_ROLES_KEY } from '../decorators/admin-role.decorator';

@Injectable()
export class AdminRolesGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<AdminRole[]>(ADMIN_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;

    const { user } = context.switchToHttp().getRequest();
    const adminProfile = await this.prisma.adminProfile.findUnique({ where: { userId: user.sub } });

    if (!adminProfile || !requiredRoles.includes(adminProfile.adminRole)) {
      throw new ForbiddenException('Your admin role does not permit this action');
    }
    return true;
  }
}
```

### Usage — finance-only refund endpoint

```typescript
// admin-payments.controller.ts
import { AdminRoles } from '../../../common/decorators/admin-role.decorator';

@Roles('ADMIN')
@Controller('admin/payments')
export class AdminPaymentsController {

  @AdminRoles('SUPER_ADMIN', 'FINANCE_OFFICER')
  @Post(':id/refund')
  async refund(@Param('id') paymentId: string, @Body() dto: IssueRefundDto, @CurrentUser() admin) {
    const result = await this.paymentsService.issueRefund(paymentId, BigInt(dto.amountKobo), dto.reason, admin.sub);
    await this.adminLogger.log(admin.sub, 'REFUND_ISSUED', 'payment', paymentId, dto.reason);
    return result;
  }
}
```

> ⚠️ **`AdminRolesGuard` and `RolesGuard` are layered, not exclusive.** `RolesGuard` confirms the user is some kind of admin (`role: 'ADMIN'`). `AdminRolesGuard` then confirms *which kind* of admin for routes that need it. A `VERIFICATION_OFFICER` should be blocked from issuing refunds even though they pass the first check.

---

## 🗂️ Step 3 — Admin Sub-Controllers

### Verification queue

```typescript
// src/modules/admin/controllers/admin-verifications.controller.ts
import { Controller, Get, Patch, Param, Body, Query } from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator';
import { AdminRoles } from '../../../common/decorators/admin-role.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AdminVerificationsService } from '../services/admin-verifications.service';
import { AdminLoggerService } from '../services/admin-logger.service';

@Roles('ADMIN')
@Controller('admin/verifications')
export class AdminVerificationsController {
  constructor(
    private verificationsService: AdminVerificationsService,
    private adminLogger: AdminLoggerService,
  ) {}

  @Get()
  async queue(@Query('status') status?: string) {
    return this.verificationsService.getQueue(status);
  }

  @AdminRoles('SUPER_ADMIN', 'VERIFICATION_OFFICER')
  @Patch(':id')
  async review(
    @Param('id') id: string,
    @Body() dto: { decision: 'approve' | 'reject' | 'request_docs'; note?: string },
    @CurrentUser() admin,
  ) {
    const result = await this.verificationsService.review(id, dto.decision, dto.note, admin.sub);
    await this.adminLogger.log(admin.sub, `VERIFICATION_${dto.decision.toUpperCase()}`, 'verification', id, dto.note);
    return result;
  }
}
```

```typescript
// src/modules/admin/services/admin-verifications.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class AdminVerificationsService {
  constructor(private prisma: PrismaService, private eventEmitter: EventEmitter2) {}

  async getQueue(status = 'PENDING') {
    return this.prisma.verification.findMany({
      where: { status: status as any },
      orderBy: { createdAt: 'asc' },
    });
  }

  async review(id: string, decision: string, note: string | undefined, adminId: string) {
    const verification = await this.prisma.verification.findUnique({ where: { id } });
    if (!verification) throw new NotFoundException('Verification not found');

    const statusMap: Record<string, string> = {
      approve: 'VERIFIED',
      reject: 'REJECTED',
      request_docs: 'PENDING',
    };

    await this.prisma.verification.update({
      where: { id },
      data: { status: statusMap[decision] as any, adminNote: note, reviewedBy: adminId, reviewedAt: new Date() },
    });

    if (decision === 'approve') {
      await this.prisma.workerProfile.update({
        where: { userId: verification.userId },
        data: { verificationStatus: 'VERIFIED' },
      });
    }

    this.eventEmitter.emit('verification.status_changed', { userId: verification.userId, status: statusMap[decision] });
    return { status: statusMap[decision] };
  }
}
```

### Dispute resolution

```typescript
// src/modules/admin/controllers/admin-bookings.controller.ts (dispute portion)
@AdminRoles('SUPER_ADMIN', 'SUPPORT_AGENT')
@Patch('disputes/:id/resolve')
async resolveDispute(
  @Param('id') bookingId: string,
  @Body() dto: { decision: 'refund_client' | 'partial_refund' | 'release_to_worker' | 'escalate'; outcome: string; refundAmountKobo?: string },
  @CurrentUser() admin,
) {
  const result = await this.bookingsAdminService.resolveDispute(bookingId, dto, admin.sub);
  await this.adminLogger.log(admin.sub, 'DISPUTE_RESOLVED', 'booking', bookingId, dto.outcome);
  return result;
}
```

```typescript
// admin-bookings service (dispute resolution logic)
async resolveDispute(bookingId: string, dto: any, adminId: string) {
  const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: { payment: true } });
  if (!booking || booking.status !== 'DISPUTED') throw new BadRequestException('No active dispute on this booking');

  if (dto.decision === 'refund_client') {
    await this.paymentsService.issueRefund(booking.payment.id, booking.totalAmountKobo, dto.outcome, adminId);
  } else if (dto.decision === 'partial_refund') {
    await this.paymentsService.issueRefund(booking.payment.id, BigInt(dto.refundAmountKobo), dto.outcome, adminId);
  } else if (dto.decision === 'release_to_worker') {
    await this.payoutsQueue.add('release-escrow', { bookingId, workerId: booking.workerId, amountKobo: booking.workerAmountKobo.toString() });
  }

  await this.prisma.booking.update({
    where: { id: bookingId },
    data: { status: dto.decision === 'escalate' ? 'DISPUTED' : 'COMPLETED' },
  });

  this.eventEmitter.emit('dispute.resolved', { bookingId, clientId: booking.clientId, workerId: booking.workerId, outcome: dto.outcome });
  return { status: 'resolved', decision: dto.decision };
}
```

> ⚠️ **Dispute resolution is the single most consequential admin action in the system — it moves real money.** Every resolution path must write a complete `AdminLog` entry including the written outcome, and must notify both parties via the existing `NotificationsModule` listeners from Phase 7. Never allow a silent resolution.

---

## 🔌 Step 4 — Socket.io Gateway

```typescript
// src/infrastructure/socket/socket.gateway.ts
import {
  WebSocketGateway, WebSocketServer, SubscribeMessage,
  OnGatewayConnection, OnGatewayDisconnect, MessageBody, ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../redis/redis.service';
import { ChatService } from '../../modules/chat/chat.service';

interface AuthenticatedSocket extends Socket {
  data: { userId: string; role: string };
}

@WebSocketGateway({
  cors: { origin: [process.env.CLIENT_URL!, process.env.WORKER_URL!, process.env.ADMIN_URL!], credentials: true },
  namespace: '/chat',
})
@Injectable()
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  constructor(
    private jwtService: JwtService,
    private redis: RedisService,
    private chatService: ChatService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = client.handshake.auth?.token;
      const payload = this.jwtService.verify(token, {
        publicKey: process.env.JWT_PUBLIC_KEY!.replace(/\\n/g, '\n'),
        algorithms: ['RS256'],
      });

      client.data.userId = payload.sub;
      client.data.role = payload.role;

      client.join(`user:${payload.sub}`);
      await this.redis.setex(`presence:${payload.sub}`, 90, 'online');
      this.server.emit('chat:presence', { userId: payload.sub, status: 'online' });
    } catch {
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    if (!client.data?.userId) return;
    await this.redis.del(`presence:${client.data.userId}`);
    this.server.emit('chat:presence', { userId: client.data.userId, status: 'offline' });
  }

  @SubscribeMessage('chat:join')
  async handleJoin(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() { conversationId }: any) {
    const allowed = await this.chatService.canAccess(client.data.userId, conversationId);
    if (!allowed) return { error: 'FORBIDDEN' };

    client.join(`conv:${conversationId}`);
    const messages = await this.chatService.getHistory(conversationId, 50);
    client.emit('chat:history', { messages });
    await this.chatService.markRead(conversationId, client.data.userId);
  }

  @SubscribeMessage('chat:send')
  async handleSend(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() dto: any) {
    const allowed = await this.chatService.canAccess(client.data.userId, dto.conversationId);
    if (!allowed) return { error: 'FORBIDDEN' };

    const message = await this.chatService.persistMessage({
      conversationId: dto.conversationId,
      senderId: client.data.userId,
      text: dto.text,
      fileUrl: dto.fileUrl,
      fileType: dto.fileType,
      fileName: dto.fileName,
    });

    this.server.to(`conv:${dto.conversationId}`).emit('chat:message', { message });
    client.emit('chat:message:ack', { messageId: message.id, sentAt: message.createdAt });
  }

  @SubscribeMessage('chat:typing')
  handleTyping(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() { conversationId }: any) {
    client.to(`conv:${conversationId}`).emit('chat:typing', { userId: client.data.userId, conversationId });
  }

  @SubscribeMessage('chat:read')
  async handleRead(@ConnectedSocket() client: AuthenticatedSocket, @MessageBody() { conversationId, lastReadAt }: any) {
    await this.chatService.markRead(conversationId, client.data.userId, lastReadAt);
    client.to(`conv:${conversationId}`).emit('chat:read', { userId: client.data.userId, conversationId, lastReadAt });
  }

  @SubscribeMessage('chat:heartbeat')
  async handleHeartbeat(@ConnectedSocket() client: AuthenticatedSocket) {
    await this.redis.setex(`presence:${client.data.userId}`, 90, 'online');
  }
}
```

> ⚠️ **Socket.io authentication happens once, at connection time — not per-message.** If the JWT verification in `handleConnection` fails, disconnect immediately. Every subsequent message handler trusts `client.data.userId`, which was only ever set after a successful verification.

> ⚠️ **CORS for Socket.io is configured separately from Express CORS.** The `cors` option inside `@WebSocketGateway()` is independent of whatever you configured in `main.ts` — both must list the same allowed origins or one transport will work while the other silently fails.

---

## 💬 Step 5 — ChatModule

```typescript
// src/modules/chat/chat.service.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';

const ALLOWED_CHAT_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'audio/mpeg', 'audio/ogg'];
const MAX_CHAT_FILE_SIZE = 10 * 1024 * 1024;

@Injectable()
export class ChatService {
  constructor(private prisma: PrismaService, private storage: StorageService) {}

  async canAccess(userId: string, conversationId: string): Promise<boolean> {
    const conversation = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conversation) return false;
    if (![conversation.participantA, conversation.participantB].includes(userId)) return false;

    // Admins can access any conversation for support purposes
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.role === 'ADMIN') return true;

    if (conversation.bookingId) {
      const booking = await this.prisma.booking.findUnique({ where: { id: conversation.bookingId } });
      if (!booking) return false;
      const allowedStatuses = ['CONFIRMED', 'IN_PROGRESS'];
      const withinReviewWindow = booking.status === 'COMPLETED'
        && Date.now() - booking.actualEnd!.getTime() < 7 * 24 * 3600_000;
      return allowedStatuses.includes(booking.status) || withinReviewWindow;
    }

    return true; // Admin-initiated support conversations have no bookingId
  }

  async getHistory(conversationId: string, limit: number) {
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async persistMessage(data: { conversationId: string; senderId: string; text?: string; fileUrl?: string; fileType?: string; fileName?: string }) {
    return this.prisma.message.create({ data });
  }

  async markRead(conversationId: string, userId: string, lastReadAt?: string) {
    await this.prisma.message.updateMany({
      where: { conversationId, senderId: { not: userId }, readAt: null },
      data: { readAt: lastReadAt ? new Date(lastReadAt) : new Date() },
    });
  }

  async uploadAttachment(conversationId: string, mimeType: string, fileSize: number, filename: string) {
    if (!ALLOWED_CHAT_TYPES.includes(mimeType)) throw new BadRequestException('Unsupported file type for chat');
    if (fileSize > MAX_CHAT_FILE_SIZE) throw new BadRequestException('File exceeds 10MB limit');

    const key = this.storage.buildKey(`chat/${conversationId}`, conversationId, filename);
    return this.storage.getPresignedUploadUrl(key, mimeType, fileSize);
  }
}
```

> ⚠️ **Chat availability rules are enforced in `canAccess`, called on every `chat:join` and `chat:send` — not just once on conversation creation.** A booking's status can change between the conversation being created and a later message being sent; checking access on every action ensures a cancelled booking can't be used to keep chatting indefinitely.

```typescript
// src/modules/chat/chat.controller.ts
import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private chatService: ChatService) {}

  @Get(':id/messages')
  async getMessages(@Param('id') conversationId: string, @Query('limit') limit = 50) {
    return this.chatService.getHistory(conversationId, Number(limit));
  }

  @Post('upload')
  async uploadFile(@Body() dto: { conversationId: string; mimeType: string; fileSize: number; filename: string }) {
    return this.chatService.uploadAttachment(dto.conversationId, dto.mimeType, dto.fileSize, dto.filename);
  }

  @Get('presence/:userId')
  async getPresence(@Param('userId') userId: string) {
    const status = await this.redis.get(`presence:${userId}`);
    return { userId, status: status ?? 'offline' };
  }
}
```

---

## 📝 Admin Audit Logging

Every state-changing admin action must call this service. Make it a habit from the first admin endpoint you write.

```typescript
// src/modules/admin/services/admin-logger.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

@Injectable()
export class AdminLoggerService {
  constructor(private prisma: PrismaService) {}

  async log(adminId: string, action: string, targetType: string, targetId: string, reason?: string, metadata?: any) {
    return this.prisma.adminLog.create({
      data: { adminId, action, targetType, targetId, reason, metadata },
    });
  }
}
```

> ⚠️ **`admin_logs` is append-only, identically to `booking_logs` in Phase 5.** This is the record that protects both the platform and the admin team if a decision is ever questioned — every refund, suspension, dispute resolution, and verification approval needs a row here with a human-readable reason.

---

## 📡 API Reference

| Method | Endpoint | Admin sub-role | Description |
|---|---|---|---|
| GET | `/admin/users` | Any admin | List all users with filters |
| PATCH | `/admin/users/:id/status` | SUPER_ADMIN, SUPPORT_AGENT | Suspend / deactivate / reinstate |
| GET | `/admin/verifications` | Any admin | Verification queue |
| PATCH | `/admin/verifications/:id` | SUPER_ADMIN, VERIFICATION_OFFICER | Approve / reject / request docs |
| GET | `/admin/bookings` | Any admin | All bookings with filters |
| PATCH | `/admin/bookings/:id/cancel` | SUPER_ADMIN, SUPPORT_AGENT | Force-cancel a booking |
| PATCH | `/admin/disputes/:id/resolve` | SUPER_ADMIN, SUPPORT_AGENT | Resolve dispute |
| GET | `/admin/payments` | SUPER_ADMIN, FINANCE_OFFICER | All transactions |
| POST | `/admin/payments/:id/refund` | SUPER_ADMIN, FINANCE_OFFICER | Issue refund |
| GET | `/admin/payouts` | SUPER_ADMIN, FINANCE_OFFICER | Payout queue |
| PATCH | `/admin/payouts/:id/release` | SUPER_ADMIN, FINANCE_OFFICER | Manual payout trigger |
| GET | `/admin/reviews` | Any admin | Review moderation queue |
| DELETE | `/admin/reviews/:id` | SUPER_ADMIN, SUPPORT_AGENT | Remove a review |
| GET | `/admin/reports` | Any admin | All incident reports |
| PATCH | `/admin/reports/:id` | SUPER_ADMIN, SUPPORT_AGENT | Update status / outcome |
| GET | `/admin/logs` | SUPER_ADMIN only | Admin audit log |
| GET | `/admin/analytics` | Any admin | Platform KPIs |
| GET | `/chat/:id/messages` | JWT (any) | Message history |
| POST | `/chat/upload` | JWT (any) | File attachment presign |
| GET | `/chat/presence/:userId` | JWT (any) | Redis presence lookup |

---

## ✅ Verification Checklist

- [ ] A `VERIFICATION_OFFICER` admin can approve verifications but gets 403 on `/admin/payments/:id/refund`
- [ ] A `FINANCE_OFFICER` admin can issue refunds but gets 403 on `/admin/verifications/:id`
- [ ] Every refund, suspension, dispute resolution, and verification decision creates a row in `admin_logs`
- [ ] GET `/admin/logs` is blocked for any admin role except `SUPER_ADMIN`
- [ ] Socket.io connection with an expired or invalid JWT is immediately disconnected
- [ ] `chat:join` on a conversation tied to a `PENDING` booking returns `{ error: 'FORBIDDEN' }`
- [ ] `chat:join` on a conversation tied to a `COMPLETED` booking still works within 7 days, fails after
- [ ] An admin can join any conversation regardless of booking status
- [ ] Two browser tabs connected as the same user both receive `chat:message` events (room broadcast confirmed)
- [ ] Presence correctly flips to `offline` within ~90 seconds of a client disconnecting without a clean close
- [ ] File upload to `/chat/upload` rejects files over 10MB and unsupported MIME types

---

## ⚠️ Common Pitfalls

> **Pitfall: forgetting `AdminRolesGuard` is opt-in per route.**
> Unlike `RolesGuard`, which is global, `AdminRolesGuard` only activates on routes decorated with `@AdminRoles(...)`. A route with no `@AdminRoles` decorator is accessible to *any* admin sub-role — this is correct for read-only queue views, but dangerous if forgotten on a destructive action like refunds.

> **Pitfall: chat access checks that only run at conversation creation.**
> If `canAccess` is checked once when a conversation starts but never again, a booking that gets cancelled or disputed after the chat begins leaves the channel open indefinitely. Always re-check on every `chat:join` and `chat:send`.

> **Pitfall: Socket.io rooms vs HTTP sessions are different concerns.**
> A user's JWT access token can expire while their socket connection remains open (sockets don't automatically re-verify on every message). For an MVP this is an acceptable trade-off, but be aware: a revoked `jti` won't disconnect an already-connected socket until the next reconnection. Document this as a known limitation rather than treating it as solved.

> **Pitfall: not testing presence with an actual network drop.**
> Closing a browser tab cleanly triggers `disconnect` immediately. A genuine network failure (phone losing signal) does not — Socket.io relies on its ping/pong heartbeat timeout to detect this, which can take up to the configured `pingTimeout`. Test with airplane mode, not just closing tabs, before trusting your presence indicator in production.

---

## 🎉 All Phases Complete

With this phase done, every module described in the original architecture document is live: auth, profiles, verification, search, availability, bookings, payments, reviews, reports, notifications, admin, and chat. The next step is connecting the three frontends — client, worker/student, and admin — against this now-complete API surface.

---

*Last updated: June 2026*