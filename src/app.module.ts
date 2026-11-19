import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './infrastructure/prisma/prisma.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { StorageModule } from './infrastructure/storage/storage.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { ProfilesModule } from './modules/profiles/profiles.module.js';
import { VerificationModule } from './modules/verification/verification.module.js';
import { WorkersModule } from './modules/workers/workers.module.js';
import { AvailabilityModule } from './modules/availability/availability.module.js';
import { BookingsModule } from './modules/bookings/bookings.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { ReviewsModule } from './modules/reviews/reviews.module.js';
import { ReportsModule } from './modules/reports/reports.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { ChatModule } from './modules/chat/chat.module.js';
import { SocketModule } from './infrastructure/socket/socket.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { AdminRolesGuard } from './common/guards/admin-roles.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { MailModule } from './modules/mail/mail.module.js';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        transport:
          process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
      },
    }),

    EventEmitterModule.forRoot(),

    ScheduleModule.forRoot(),

    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [
          { name: 'short', ttl: 60_000, limit: 10 },
          { name: 'medium', ttl: 600_000, limit: 3 },
          { name: 'long', ttl: 60_000, limit: 120 },
        ],
        storage: new ThrottlerStorageRedisService(process.env.REDIS_URL!),
      }),
    }),

    BullModule.forRootAsync({
      useFactory: () => {
        const url = new URL(process.env.REDIS_URL!);
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port) || 6379,
            username: url.username || undefined,
            password: url.password || undefined,
            tls: url.protocol === 'rediss:' ? { rejectUnauthorized: false } : undefined,
          },
        };
      },
    }),

    PrismaModule,
    RedisModule,
    StorageModule,
    AuthModule,
    UsersModule,
    ProfilesModule,
    VerificationModule,
    WorkersModule,
    AvailabilityModule,
    BookingsModule,
    PaymentsModule,
    ReviewsModule,
    ReportsModule,
    NotificationsModule,
    AdminModule,
    ChatModule,
    SocketModule,
    MailModule,
  ],
  providers: [
    // { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: AdminRolesGuard },
  ],
})
export class AppModule {}
