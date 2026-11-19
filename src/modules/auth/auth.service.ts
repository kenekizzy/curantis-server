import {
  Injectable,
  BadRequestException,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { Role, AdminRole } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { ResetPasswordDto } from './dto/reset-password.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private jwt: JwtService,
    @InjectQueue('notifications') private notifQueue: Queue,
  ) {}

  async register(dto: RegisterDto): Promise<{ userId: string }> {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { phone: dto.phone }] },
    });
    if (existing) throw new ConflictException('Account already exists');

    //This check will be updated on production
    //await this.checkPasswordBreach(dto.password);
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

    await this.sendOtp(dto.email);

    return { userId: user.id };
  }

  async sendOtp(identifier: string): Promise<void> {
    const otp = crypto.randomInt(100_000, 999_999).toString();
    const hash = await bcrypt.hash(otp, 10);

    await this.redis.setex(`otp:${identifier}`, 600, hash);
    await this.notifQueue.add('send-otp', { identifier, otp });
  }

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

    if (identifier.includes('@')) {
      await this.notifQueue.add('send-successful-signup-email', { email: identifier });
    }

    return true;
  }

  async login(
    identifier: string,
    password: string,
    role: Role,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { phone: identifier }], role },
    });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const lockKey = `login-attempts:${user.id}`;
    const attempts = await this.redis.incr(lockKey);
    if (attempts === 1) await this.redis.expire(lockKey, 900);
    if (attempts > 5) throw new ForbiddenException('Account locked. Try again in 15 minutes.');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    if (user.status === 'SUSPENDED') throw new ForbiddenException('Account suspended');

    await this.redis.del(lockKey);

    return this.issueTokens(user.id, user.role);
  }

  async refresh(
    rawToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const existing = await this.prisma.refreshToken.findFirst({
      where: { tokenHash: hash, revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    });
    if (!existing) throw new UnauthorizedException('Invalid or expired refresh token');

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(existing.user.id, existing.user.role);
  }

  async logout(userId: string, jti: string, rawRefreshToken?: string): Promise<void> {
    await this.redis.setex(`revoked:${jti}`, Number(process.env.JWT_ACCESS_EXPIRY ?? 900), '1');

    if (rawRefreshToken) {
      const hash = crypto.createHash('sha256').update(rawRefreshToken).digest('hex');
      await this.prisma.refreshToken.updateMany({
        where: { userId, tokenHash: hash, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  async loginWithGoogle(
    googleSub: string,
    email: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.findOrCreateGoogleUser(googleSub, email);
    return this.issueTokens(user.id, user.role);
  }

  private async findOrCreateGoogleUser(googleSub: string, email: string) {
    const byGoogleSub = await this.prisma.user.findUnique({ where: { googleSub } });
    if (byGoogleSub) return byGoogleSub;

    const byEmail = await this.prisma.user.findUnique({ where: { email } });
    if (byEmail) {
      return this.prisma.user.update({ where: { id: byEmail.id }, data: { googleSub } });
    }

    return this.prisma.user.create({
      data: { email, googleSub, emailVerified: true, status: 'ACTIVE', role: 'CLIENT' },
    });
  }

  async requestPasswordReset(identifier: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { phone: identifier }] },
    });
    if (!user) return; // Don't reveal whether the account exists

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await this.redis.setex(`reset:${hash}`, 3600, user.id);
    await this.notifQueue.add('send-reset-link', { identifier, token: rawToken });

    // Also issue a 6-digit OTP code for mobile & in-app reset flows
    const otp = crypto.randomInt(100_000, 999_999).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    await this.redis.setex(`reset-otp:${identifier}`, 600, otpHash);
    await this.notifQueue.add('send-otp', { identifier, otp });
  }

  async resetPassword(
    tokenOrDto: string | ResetPasswordDto,
    newPassword?: string,
  ): Promise<void> {
    let resolvedPassword = newPassword;
    let userId: string | null = null;

    if (typeof tokenOrDto === 'object') {
      resolvedPassword = tokenOrDto.newPassword;

      if (tokenOrDto.code && tokenOrDto.identifier) {
        const hash = await this.redis.get(`reset-otp:${tokenOrDto.identifier}`);
        if (!hash) throw new BadRequestException('Invalid or expired reset code');
        const valid = await bcrypt.compare(tokenOrDto.code, hash);
        if (!valid) throw new BadRequestException('Invalid or expired reset code');

        const user = await this.prisma.user.findFirst({
          where: { OR: [{ email: tokenOrDto.identifier }, { phone: tokenOrDto.identifier }] },
          select: { id: true },
        });
        if (!user) throw new BadRequestException('User not found');
        userId = user.id;
        await this.redis.del(`reset-otp:${tokenOrDto.identifier}`);
      } else if (tokenOrDto.token) {
        const hash = crypto.createHash('sha256').update(tokenOrDto.token).digest('hex');
        userId = await this.redis.get(`reset:${hash}`);
        if (!userId) throw new BadRequestException('Invalid or expired reset link');
        await this.redis.del(`reset:${hash}`);
      } else {
        throw new BadRequestException('Reset code or token is required');
      }
    } else {
      const hash = crypto.createHash('sha256').update(tokenOrDto).digest('hex');
      userId = await this.redis.get(`reset:${hash}`);
      if (!userId) throw new BadRequestException('Invalid or expired reset link');
      await this.redis.del(`reset:${hash}`);
    }

    if (!resolvedPassword) {
      throw new BadRequestException('New password is required');
    }

    const passwordHash = await bcrypt.hash(resolvedPassword, 12);
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash } });

    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async issueTokens(
    userId: string,
    role: Role,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const jti = crypto.randomUUID();

    const accessToken = this.jwt.sign(
      { sub: userId, role, jti },
      {
        privateKey: process.env.JWT_PRIVATE_KEY!.replace(/\\n/g, '\n'),
        algorithm: 'RS256',
        expiresIn: Number(process.env.JWT_ACCESS_EXPIRY ?? 900),
      },
    );

    const refreshTokenRaw = crypto.randomBytes(32).toString('hex');
    const refreshTokenHash = crypto.createHash('sha256').update(refreshTokenRaw).digest('hex');

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: refreshTokenHash,
        expiresAt: new Date(
          Date.now() + Number(process.env.JWT_REFRESH_EXPIRY ?? 2_592_000) * 1000,
        ),
      },
    });

    return { accessToken, refreshToken: refreshTokenRaw };
  }

  async loginAdmin(
    identifier: string,
    password: string,
  ): Promise<{ accessToken: string; refreshToken: string; adminRole: AdminRole }> {
    const user = await this.prisma.user.findFirst({
      where: {
        AND: [
          { OR: [{ email: identifier }, { phone: identifier }] },
          { role: 'ADMIN' },
        ],
      },
    });
    if (!user || !user.passwordHash) throw new UnauthorizedException('Invalid credentials');

    const lockKey = `login-attempts:admin:${user.id}`;
    const attempts = await this.redis.incr(lockKey);
    if (attempts === 1) await this.redis.expire(lockKey, 900);
    if (attempts > 5) throw new ForbiddenException('Account locked. Try again in 15 minutes.');

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    if (user.status === 'SUSPENDED') throw new ForbiddenException('Account suspended');

    const adminProfile = await this.prisma.adminProfile.findUnique({
      where: { userId: user.id },
    });
    if (!adminProfile) throw new ForbiddenException('No admin profile associated with this account');

    await this.redis.del(lockKey);

    const tokens = await this.issueTokens(user.id, user.role);

    return {
      ...tokens,
      adminRole: adminProfile.adminRole,
    };
  }

  async createNewAdmin(
    userSub: string,
    identifier: string,
    password: string,
    adminRole: AdminRole,
  ): Promise<void> {
    const adminUser = await this.prisma.adminProfile.findUnique({
      where: { userId: userSub },
    });
    if (!adminUser) throw new BadRequestException('Admin does not exist');
    if (adminUser.adminRole !== 'SUPER_ADMIN') throw new ForbiddenException('You are not authorized to create a new admin');
    const existingAdmin = await this.prisma.user.findUnique({
      where: { email: identifier },
    });
    if (existingAdmin) throw new BadRequestException('Admin already exists');
    const user = await this.prisma.user.create({
      data: { email: identifier, passwordHash: await bcrypt.hash(password, 12), role: 'ADMIN' },
    });
    await this.prisma.adminProfile.create({
      data: { userId: user.id, adminRole },
    });

    this.notifQueue.add('send-admin-welcome', { email: user.email, password, adminRole });

  }

  async updateAdminPassword(
    userSub: string,
    email: string,
    newPassword: string,
    oldPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if(user.id !== userSub) throw new ForbiddenException('You are not authorized to update this admin password');
    const valid = await bcrypt.compare(oldPassword, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');
    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 12) },
    });

    this.notifQueue.add("admin-password-update", {email: user.email})
  }

  async deleteAdmin(
    userSub: string,
    adminId: string,
  ): Promise<void> {
    const adminProfile = await this.prisma.adminProfile.findUnique({
      where: { userId: userSub },
    });
    if (!adminProfile) throw new BadRequestException('Admin does not exist');
    if (adminProfile.adminRole !== 'SUPER_ADMIN') throw new ForbiddenException('You are not authorized to delete an admin');
    await this.prisma.adminProfile.delete({
      where: { userId: adminId },
    });
    await this.prisma.user.delete({
      where: { id: adminId },
    });
  }

  async updateAdminRole(
    adminId: string,
    adminRole: AdminRole,
  ): Promise<void> {
    await this.prisma.adminProfile.update({
      where: { userId: adminId },
      data: { adminRole },
    });
  }

  // private async checkPasswordBreach(password: string): Promise<void> {
  //   const sha1 = crypto.createHash('sha1').update(password).digest('hex').toUpperCase();
  //   const prefix = sha1.slice(0, 5);
  //   const suffix = sha1.slice(5);

  //   try {
  //     const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
  //     const text = await res.text();
  //     if (text.includes(suffix)) {
  //       throw new BadRequestException(
  //         'This password has appeared in a known data breach. Please choose another.',
  //       );
  //     }
  //   } catch (err) {
  //     if (err instanceof BadRequestException) throw err;
  //     // API unreachable — fail open, don't block registration
  //   }
  // }
}
