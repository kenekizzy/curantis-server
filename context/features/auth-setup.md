# Phase 2 — Auth Module (The Keystone)

## Overview

Every protected route in every subsequent phase depends on this module. By the end, a user can register, verify via OTP, log in, refresh their session, sign in with Google, and reset a forgotten password — and every request to a protected route is independently verified for both authentication (who are you) and authorization (what role are you).

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

> JWT RS256 · Refresh token rotation · OTP · Google OAuth · RBAC
> **Estimated time:** ~3 days · Nothing else works without this

---

## 📋 Table of Contents

- [Goal](#-goal)
- [Step 1 — User Schema & Migration](#-step-1--user-schema--migration)
- [Step 2 — Register Endpoint](#-step-2--register-endpoint)
- [Step 3 — OTP Flow](#-step-3--otp-flow)
- [Step 4 — JWT RS256 Strategy](#-step-4--jwt-rs256-strategy)
- [Step 5 — Google OAuth](#-step-5--google-oauth)
- [Step 6 — Global Guards](#-step-6--global-guards)
- [Step 7 — Password Reset Flow](#-step-7--password-reset-flow)
- [API Reference](#-api-reference)
- [Verification Checklist](#-verification-checklist)
- [Common Pitfalls](#-common-pitfalls)

---


---

## 🗄️ Step 1 — User Schema & Migration

```prisma
// prisma/schema.prisma

enum Role {
  CLIENT
  HW
  HS
  ADMIN
}

enum UserStatus {
  PENDING
  ACTIVE
  SUSPENDED
  DEACTIVATED
}

model User {
  id            String     @id @default(cuid())
  email         String?    @unique
  phone         String?    @unique
  emailVerified Boolean    @default(false)
  phoneVerified Boolean    @default(false)
  passwordHash  String?
  googleSub     String?    @unique
  role          Role
  status        UserStatus @default(PENDING)
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt
  deletedAt     DateTime?

  refreshTokens RefreshToken[]

  @@index([role, status])
  @@map("users")
}

model RefreshToken {
  id         String    @id @default(cuid())
  userId     String
  tokenHash  String
  deviceHint String?
  expiresAt  DateTime
  revokedAt  DateTime?
  replacedBy String?
  createdAt  DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([tokenHash, userId, expiresAt])
  @@map("refresh_tokens")
}
```

---

## 📝 Step 2 — Register Endpoint

```bash
npm add bcrypt
npm add -D @types/bcrypt
```

### DTO

```typescript
// src/modules/auth/dto/register.dto.ts
import { IsEmail, IsEnum, IsOptional, IsPhoneNumber, IsString, MinLength, Matches } from 'class-validator';
import { Role } from '@prisma/client';

export class RegisterDto {
  @IsOptional() @IsEmail()
  email?: string;

  @IsOptional() @IsPhoneNumber('NG')
  phone?: string;

  @IsString() @MinLength(8)
  @Matches(/^(?=.*[A-Z])(?=.*\d).+$/, { message: 'Password must contain an uppercase letter and a number' })
  password: string;

  @IsEnum(Role)
  role: Role;
}
```

### Service

```typescript
// src/modules/auth/auth.service.ts
import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    @InjectQueue('notifications') private notifQueue: Queue,
  ) {}

  async register(dto: RegisterDto) {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('Either email or phone is required');
    }

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { phone: dto.phone }] },
    });
    if (existing) throw new ConflictException('Account already exists');

    await this.checkPasswordBreach(dto.password);
    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        role: dto.role,
        status: 'PENDING',
      },
    });

    const identifier = dto.email ?? dto.phone!;
    await this.sendOtp(identifier);

    return { userId: user.id };
  }

  async sendOtp(identifier: string): Promise<void> {
    const otp = crypto.randomInt(100000, 999999).toString();
    const hash = await bcrypt.hash(otp, 10);

    await this.redis.setex(`otp:${identifier}`, 600, hash); // 10 min TTL

    await this.notifQueue.add('send-otp', { identifier, otp });
  }

  private async checkPasswordBreach(password: string): Promise<void> {
    const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    try {
      const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
      const text = await res.text();
      if (text.includes(suffix)) {
        throw new BadRequestException('This password has appeared in a known data breach. Please choose another.');
      }
    } catch {
      // If the breach-check API is unreachable, fail open — don't block registration
    }
  }
}
```

> ⚠️ **Fail open on the breach check.** If HaveIBeenPwned's API is down, don't block registration entirely — log it and proceed. A third-party outage should never become your outage.

---

## 🔢 Step 3 — OTP Flow

### Controller

```typescript
// src/modules/auth/auth.controller.ts (partial)
import { Controller, Post, Body } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('otp/verify')
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    const valid = await this.authService.verifyOtp(dto.identifier, dto.code);
    if (!valid) throw new BadRequestException('Invalid or expired code');
    return { verified: true };
  }

  @Public()
  @Throttle({ medium: { limit: 3, ttl: 600_000 } })
  @Post('otp/resend')
  async resendOtp(@Body('identifier') identifier: string) {
    await this.authService.sendOtp(identifier);
    return { sent: true };
  }
}
```

### Service — verify OTP

```typescript
// auth.service.ts (continued)
async verifyOtp(identifier: string, code: string): Promise<boolean> {
  const hash = await this.redis.get(`otp:${identifier}`);
  if (!hash) return false;

  const valid = await bcrypt.compare(code, hash);
  if (!valid) return false;

  await this.redis.del(`otp:${identifier}`);

  await this.prisma.user.updateMany({
    where: { OR: [{ email: identifier }, { phone: identifier }] },
    data: identifier.includes('@')
      ? { emailVerified: true, status: 'ACTIVE' }
      : { phoneVerified: true, status: 'ACTIVE' },
  });

  return true;
}
```

> ⚠️ **Never store the raw OTP, even temporarily.** Hash it with bcrypt before storing in Redis, exactly as you would a password. If your Redis instance is ever compromised, raw OTPs would let an attacker take over any pending registration.

---

## 🔐 Step 4 — JWT RS256 Strategy

```bash
npm add @nestjs/passport passport passport-jwt @nestjs/jwt
npm add -D @types/passport-jwt
```

### Generate the RSA keypair

```bash
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

Paste the contents into `.env` as single-line strings with `\n` for line breaks:

```env
JWT_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----"
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG...\n-----END PUBLIC KEY-----"
JWT_ACCESS_EXPIRY=900
JWT_REFRESH_EXPIRY=2592000
```

### JWT payload type

```typescript
// src/common/types/jwt-payload.type.ts
import { Role } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  role: Role;
  jti: string;
  iat: number;
  exp: number;
}
```

### Strategy

```typescript
// src/modules/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RedisService } from '../../../infrastructure/redis/redis.service';
import { JwtPayload } from '../../../common/types/jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private redis: RedisService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_PUBLIC_KEY!.replace(/\\n/g, '\n'),
      algorithms: ['RS256'],
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    const revoked = await this.redis.get(`revoked:${payload.jti}`);
    if (revoked) throw new UnauthorizedException('Token revoked');
    return payload;
  }
}
```

### Login + token issuance

```typescript
// auth.service.ts (continued)
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'crypto';

async login(identifier: string, password: string) {
  const user = await this.prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { phone: identifier }] },
  });
  if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');

  const lockKey = `login-attempts:${user.id}`;
  const attempts = await this.redis.incr(lockKey);
  if (attempts === 1) await this.redis.expire(lockKey, 900); // 15 min window
  if (attempts > 5) throw new ForbiddenException('Account locked. Try again in 15 minutes.');

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new UnauthorizedException('Invalid credentials');

  if (user.status === 'SUSPENDED') throw new ForbiddenException('Account suspended');

  await this.redis.del(lockKey); // reset on success

  return this.issueTokens(user.id, user.role);
}

private async issueTokens(userId: string, role: Role) {
  const jti = crypto.randomUUID();

  const accessToken = this.jwtService.sign(
    { sub: userId, role, jti },
    {
      privateKey: process.env.JWT_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      algorithm: 'RS256',
      expiresIn: Number(process.env.JWT_ACCESS_EXPIRY),
    },
  );

  const refreshTokenRaw = crypto.randomBytes(32).toString('hex');
  const refreshTokenHash = crypto.createHash('sha256').update(refreshTokenRaw).digest('hex');

  await this.prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: refreshTokenHash,
      expiresAt: new Date(Date.now() + Number(process.env.JWT_REFRESH_EXPIRY) * 1000),
    },
  });

  return { accessToken, refreshToken: refreshTokenRaw };
}
```

### Refresh endpoint — rotation

```typescript
// auth.service.ts (continued)
async refresh(rawToken: string) {
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const existing = await this.prisma.refreshToken.findFirst({
    where: { tokenHash: hash, revokedAt: null, expiresAt: { gt: new Date() } },
    include: { user: true },
  });
  if (!existing) throw new UnauthorizedException('Invalid or expired refresh token');

  // Rotate — revoke old, issue new
  await this.prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date() },
  });

  return this.issueTokens(existing.user.id, existing.user.role);
}
```

### Setting the refresh cookie

```typescript
// auth.controller.ts (continued)
@Public()
@Post('login')
async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
  const { accessToken, refreshToken } = await this.authService.login(dto.identifier, dto.password);

  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    maxAge: Number(process.env.JWT_REFRESH_EXPIRY) * 1000,
  });

  return { accessToken };
}
```

> ⚠️ **Never store the raw refresh token anywhere persistent.** Only the SHA-256 hash lives in the database. The raw value exists only in transit (HttpOnly cookie) and in the moment it's generated.

---

## 🔵 Step 5 — Google OAuth

```bash
npm add passport-google-oauth20
npm add -D @types/passport-google-oauth20
```

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:3000/api/v1/auth/google/callback
```

```typescript
// src/modules/auth/strategies/google.strategy.ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      callbackURL: process.env.GOOGLE_CALLBACK_URL!,
      scope: ['email', 'profile'],
    });
  }

  async validate(accessToken: string, refreshToken: string, profile: any, done: VerifyCallback) {
    const { sub, email, name } = profile._json;
    done(null, { googleSub: sub, email, name });
  }
}
```

```typescript
// auth.service.ts (continued)
async findOrCreateGoogleUser(googleSub: string, email: string) {
  let user = await this.prisma.user.findUnique({ where: { googleSub } });
  if (user) return user;

  // Merge with existing email/password account if one exists
  user = await this.prisma.user.findUnique({ where: { email } });
  if (user) {
    return this.prisma.user.update({ where: { id: user.id }, data: { googleSub } });
  }

  // New account — role must be set in a follow-up onboarding step
  return this.prisma.user.create({
    data: { email, googleSub, emailVerified: true, status: 'PENDING', role: 'CLIENT' },
  });
}
```

> ⚠️ **Never store Google's access or refresh tokens.** Only persist the `sub` claim for matching future sign-ins. You don't need ongoing access to the user's Google account — you only needed it once, to confirm their identity.

---

## 🛡️ Step 6 — Global Guards

### Public decorator

```typescript
// src/common/decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

### Roles decorator

```typescript
// src/common/decorators/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```

### Global JWT guard (registered app-wide)

```typescript
// src/common/guards/jwt-auth.guard.ts
import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}
```

### Roles guard

```typescript
// src/common/guards/roles.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Insufficient role for this resource');
    }
    return true;
  }
}
```

### Register globally

```typescript
// app.module.ts
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
```

---

## 🔑 Step 7 — Password Reset Flow

```typescript
// auth.service.ts (continued)
async requestPasswordReset(identifier: string): Promise<void> {
  const user = await this.prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { phone: identifier }] },
  });
  if (!user) return; // Don't reveal whether the account exists

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');

  await this.redis.setex(`reset:${hash}`, 3600, user.id); // 1 hour TTL

  await this.notifQueue.add('send-reset-link', { identifier, token: rawToken });
}

async resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const userId = await this.redis.get(`reset:${hash}`);
  if (!userId) throw new BadRequestException('Invalid or expired reset link');

  await this.checkPasswordBreach(newPassword);
  const passwordHash = await bcrypt.hash(newPassword, 12);

  await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  await this.redis.del(`reset:${hash}`);

  // Invalidate every existing session — force re-login everywhere
  await this.prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
```

> ⚠️ **Never reveal whether an account exists during password reset.** Always return success-shaped responses regardless of whether the identifier matched a user — this prevents account enumeration attacks.

---

## 📡 API Reference

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | Public | Register new user (any role) |
| POST | `/auth/login` | Public | Email/phone + password login |
| POST | `/auth/refresh` | Cookie | Rotate refresh token, issue new access token |
| POST | `/auth/logout` | JWT | Revoke current refresh token |
| POST | `/auth/otp/verify` | Public | Verify OTP for email/phone |
| POST | `/auth/otp/resend` | Public | Resend OTP (rate limited 3/10min) |
| POST | `/auth/password/reset-request` | Public | Send password reset link |
| POST | `/auth/password/reset` | Public | Submit new password with reset token |
| GET | `/auth/google` | Public | Initiate Google OAuth flow |
| GET | `/auth/google/callback` | Public | Google OAuth callback |

---

## ✅ Verification Checklist

- [ ] POST `/auth/register` returns 201 with a `userId`
- [ ] Duplicate email/phone registration returns 409 Conflict
- [ ] POST `/auth/otp/verify` with correct code sets `emailVerified=true` in Neon
- [ ] POST `/auth/otp/verify` with wrong code returns 400
- [ ] POST `/auth/login` returns an `accessToken` and sets the `refresh_token` cookie
- [ ] 6 failed login attempts within 15 minutes returns 403 (account locked)
- [ ] GET any protected route with a valid Bearer token succeeds
- [ ] GET any protected route with no token returns 401
- [ ] GET any protected route with an expired token returns 401
- [ ] GET an admin-only route with a `client` role token returns 403
- [ ] POST `/auth/refresh` with a valid cookie returns a new `accessToken` and rotates the refresh token (old one is `revokedAt != null` in Neon)
- [ ] POST `/auth/refresh` with an already-used (rotated) refresh token fails
- [ ] Google OAuth round-trip creates or merges a user correctly
- [ ] Password reset flow invalidates all existing refresh tokens for that user

---

## ⚠️ Common Pitfalls

> **Pitfall: forgetting `\n` escaping in the JWT keys.**
> When pasting a multi-line PEM key into a single-line `.env` value, you must literally type `\n` and then `.replace(/\\n/g, '\n')` in code. Forgetting this produces a cryptic "secret or public key must be provided" error that has nothing obviously to do with line breaks.

> **Pitfall: rate limiting before authentication.**
> The Throttler guard should run before the JWT guard in the request pipeline so that brute-force login attempts are rate-limited even with invalid credentials. NestJS applies global guards in registration order — verify `ThrottlerGuard` registration doesn't accidentally run after `JwtAuthGuard`.

> **Pitfall: role hidden in UI but not enforced server-side.**
> Hiding an admin menu item in a frontend is a UX choice, not a security boundary. Every admin route must independently check the role via `RolesGuard` regardless of what the frontend sends or hides.

> **Pitfall: testing refresh token rotation incorrectly.**
> A common mistake is testing refresh with the same token twice and expecting both to succeed. The second call should fail — that's the point of rotation. If your test allows token reuse, the rotation logic is broken.

---