# Phase 1 Scaffold and Infrastructure

## Overview

By the end of this phase, you should have a NestJS application that boots cleanly, connects to Neon PostgreSQL and Upstash Redis, and has every global safety net in place (validation, error handling, security headers, BigInt serialization) — before a single feature is written. Nothing in later phases should require touching `main.ts` again.

## Requirements for phase 

- Remove the generated `app.controller.ts`, `app.service.ts`, and their spec files — they're placeholder code you won't use. Keep `app.module.ts` as the root module that will import every feature module.
- Setup Prisman and neon `npm add @prisma/client prisma` 
- `npx prisma init`
- setup upstash Redis `npm add ioredis @nestjs/throttler bullmq`
- Set up global middleware and interceptors (validation, error handling, security headers, BigInt serialization)
- Set up Swagger API documentation
- Set up global error handling
- **Never use `prisma db push` in any environment.** Always use `npx prisma migrate dev --name <name>` in development and `npx prisma migrate deploy` in production CI/CD. `db push` skips the migration history entirely, which will bite you the first time you need to roll back or diff schemas between environments.
- `npm add helmet compression @nestjs/swagger`
- `npm add @nestjs/event-emitter eventemitter2`
- `npm add pino-http nestjs-pino pino-pretty`

## References

- @context/coding-standards.md


# Phase 1 — Scaffold & Infrastructure

> NestJS project setup · Neon PostgreSQL · Upstash Redis · Global middleware
> **Estimated time:** ~2 days · No features yet — this phase only produces infrastructure

---

## 📋 Table of Contents

- [Goal](#-goal)
- [Step 1 — Create NestJS Project](#-step-1--create-nestjs-project)
- [Step 2 — Wire Prisma to Neon](#-step-2--wire-prisma-to-neon)
- [Step 3 — Wire Redis to Upstash](#-step-3--wire-redis-to-upstash)
- [Step 4 — Global Middleware & Interceptors](#-step-4--global-middleware--interceptors)
- [Step 5 — Swagger Setup](#-step-5--swagger-setup)
- [Verification Checklist](#-verification-checklist)
- [Common Pitfalls](#-common-pitfalls)

---

### Enable strict TypeScript

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": true,
    "noImplicitAny": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

> ⚠️ **Strict mode from day one.** Retrofitting strict TypeScript onto a loose codebase later is far more painful than starting strict and relaxing a rule if you truly need to.

---

## 🗄️ Step 2 — Wire Prisma to Neon

```bash
pnpm add @prisma/client prisma
npx prisma init
```

### Configure two connection strings

Neon provides a **pooled** connection (for app queries) and a **direct** connection (for migrations). Using the pooled connection for migrations will fail silently or behave inconsistently.

```env
# .env
DATABASE_URL="postgresql://user:pass@ep-xxx.neon.tech:6543/neondb?pgbouncer=true"
DIRECT_URL="postgresql://user:pass@ep-xxx.neon.tech:5432/neondb"
```

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

### PrismaModule (global)

```typescript
// src/infrastructure/prisma/prisma.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['warn', 'error'],
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

```typescript
// src/infrastructure/prisma/prisma.module.ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

### First migration — connection smoke test

```prisma
// Minimal schema just to prove the connection works
model HealthCheck {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())

  @@map("health_checks")
}
```

```bash
npx prisma migrate dev --name init
```

Open the Neon console and confirm the `health_checks` table exists. Once confirmed, you can leave this model in place or remove it — either is fine, it served its purpose.

> ⚠️ **Never use `prisma db push` in any environment.** Always use `npx prisma migrate dev --name <name>` in development and `npx prisma migrate deploy` in production CI/CD. `db push` skips the migration history entirely, which will bite you the first time you need to roll back or diff schemas between environments.

---

## 🔴 Step 3 — Wire Redis to Upstash

```bash
npm add ioredis @nestjs/throttler bullmq
```

### Get your Upstash connection string

```env
REDIS_URL="rediss://default:xxx@xxx.upstash.io:6379"
```

### RedisModule (global)

```typescript
// src/infrastructure/redis/redis.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService extends Redis implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super(process.env.REDIS_URL!, {
      tls: { rejectUnauthorized: false },
      maxRetriesPerRequest: 3,
    });
  }

  async onModuleInit() {
    const pong = await this.ping();
    if (pong !== 'PONG') throw new Error('Redis connection failed');
  }

  async onModuleDestroy() {
    await this.quit();
  }
}
```

```typescript
// src/infrastructure/redis/redis.module.ts
import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
```

### Throttler with Redis storage

```typescript
// app.module.ts
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [
          { name: 'short',  ttl: 60_000,   limit: 10  },
          { name: 'medium', ttl: 600_000,  limit: 3   },
          { name: 'long',   ttl: 60_000,   limit: 120 },
        ],
        storage: new ThrottlerStorageRedisService(process.env.REDIS_URL!),
      }),
    }),
  ],
})
export class AppModule {}
```

> ⚠️ **Upstash free tier has request limits.** Check your plan's monthly command limit before relying on Redis for high-frequency operations like rate limiting on every request — it adds up fast during development testing.

---

## 🛡️ Step 4 — Global Middleware & Interceptors

```bash
pnpm add helmet compression @nestjs/swagger
pnpm add @nestjs/event-emitter eventemitter2
pnpm add pino-http nestjs-pino pino-pretty
```

### main.ts — the complete bootstrap

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';
import { BigIntSerializerInterceptor } from './common/interceptors/bigint-serializer.interceptor';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Security
  app.use(helmet({
    contentSecurityPolicy: true,
    hsts: { maxAge: 31536000, includeSubDomains: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));
  app.use(compression());

  // CORS — whitelist only, never wildcard in production
  app.enableCors({
    origin: [
      process.env.CLIENT_URL!,
      process.env.WORKER_URL!,
      process.env.ADMIN_URL!,
    ],
    credentials: true,
  });

  // Global validation
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }));

  // Global filters (order matters — most specific first)
  app.useGlobalFilters(new PrismaExceptionFilter(), new HttpExceptionFilter());

  // Global interceptors
  app.useGlobalInterceptors(
    new BigIntSerializerInterceptor(),
    new ResponseTransformInterceptor(),
  );

  // API prefix
  app.setGlobalPrefix('api/v1');

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

### BigInt serializer — critical, do not skip

Prisma returns `BigInt` for any `BigInt` column (which you'll use for all kobo monetary values). Node's `JSON.stringify` throws on `BigInt` by default — without this interceptor, every response touching a money field will crash.

```typescript
// src/common/interceptors/bigint-serializer.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

function serializeBigInt(obj: any): any {
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(serializeBigInt);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, serializeBigInt(v)])
    );
  }
  return obj;
}

@Injectable()
export class BigIntSerializerInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    return next.handle().pipe(map(data => serializeBigInt(data)));
  }
}
```

### Response transform interceptor

```typescript
// src/common/interceptors/response-transform.interceptor.ts
import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map(data => ({
        success: true as const,
        data: data?.items ?? data,
        meta: data?.meta ?? undefined,
      }))
    );
  }
}
```

### HTTP exception filter

```typescript
// src/common/filters/http-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const status = exception.getStatus();
    const body = exception.getResponse();

    const message = typeof body === 'string' ? body : (body as any).message;
    const details = typeof body === 'object' ? (body as any).details : undefined;

    res.status(status).json({
      success: false,
      error: {
        code: HttpException.name.replace('Exception', '').toUpperCase(),
        message,
        details,
      },
    });
  }
}
```

### Prisma exception filter

```typescript
// src/common/filters/prisma-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    const statusMap: Record<string, number> = {
      P2002: 409,
      P2025: 404,
      P2003: 400,
    };

    const status = statusMap[exception.code] ?? 500;
    const message =
      exception.code === 'P2002' ? 'Resource already exists' :
      exception.code === 'P2025' ? 'Resource not found' :
      'Database error';

    res.status(status).json({
      success: false,
      error: { code: `DB_${exception.code}`, message },
    });
  }
}
```

---

## 📖 Step 5 — Swagger Setup

```typescript
// src/main.ts — add before app.listen()
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

if (process.env.NODE_ENV !== 'production') {
  const config = new DocumentBuilder()
    .setTitle('CareGiverNG API')
    .setDescription('Healthcare marketplace backend')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
}
```

> ⚠️ **Never expose Swagger in production.** The `NODE_ENV` check above is mandatory — an exposed API schema is a reconnaissance gift to attackers. Confirm this guard works before your first staging deploy.

Add `@ApiTags('auth')` (or the relevant module name) to every controller from the start — retrofitting Swagger tags onto 60+ endpoints later is tedious and easy to forget.

---

## ✅ Verification Checklist

- [ ] `npm run start:dev` boots without errors
- [ ] Neon console shows the `health_checks` table after first migration
- [ ] `RedisService.onModuleInit()` logs a successful PING (check console)
- [ ] Hitting any route with no `Authorization` header doesn't crash the app (no guards yet — that's Phase 2)
- [ ] Swagger UI loads at `http://localhost:5000/api/docs` in development
- [ ] Swagger UI returns 404 when `NODE_ENV=production`
- [ ] Sending a `BigInt` value through a test endpoint serializes to a string, not a crash
- [ ] CORS rejects requests from an origin not in the whitelist (test with curl from a different origin header)

---

## ⚠️ Common Pitfalls

> **Pitfall: using the pooled Neon URL for migrations.**
> Migrations need the direct connection (port 5432). Using the pooled URL (port 6543, pgbouncer) for `prisma migrate dev` can cause migration locks to behave unpredictably. Always set `directUrl` in `schema.prisma`.

> **Pitfall: forgetting the BigInt interceptor until Phase 6.**
> You won't hit a `BigInt` column until the Bookings/Payments phase, by which point you'll have written several response paths assuming default JSON serialization. Set this up now even though it has nothing to serialize yet — it costs nothing today and saves a confusing crash later.

> **Pitfall: global filter registration order.**
> NestJS applies filters in the order you register them, and falls through to the next compatible filter. Register `PrismaExceptionFilter` before `HttpExceptionFilter` so Prisma-specific errors are caught first.

> **Pitfall: Upstash TLS configuration.**
> Upstash requires TLS (`rediss://` not `redis://`). If you copy the wrong URL format from the dashboard, `ioredis` will hang on connection rather than throwing a clear error — always verify with a manual `PING` test in `onModuleInit`.

---

## ➡️ Next Phase

Once every item in the verification checklist passes, move to **Phase 2 — Auth Module**. Do not start any other module before auth — every protected route in every later phase depends on the `JwtAuthGuard` and `RolesGuard` built there.