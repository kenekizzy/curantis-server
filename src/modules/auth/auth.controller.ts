import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  Res,
  UseGuards,
  BadRequestException,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  Injectable,
  ExecutionContext,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { VerifyOtpDto } from './dto/verify-otp.dto.js';
import { ResendOtpDto } from './dto/resend-otp.dto.js';
import { RequestPasswordResetDto, ResetPasswordDto } from './dto/reset-password.dto.js';
import { Public } from '../../common/decorators/public.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../../common/types/jwt-payload.type.js';

@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {
  override getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    return {
      state: request.query['state'] as string | undefined,
    };
  }
}

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: Number(process.env.JWT_REFRESH_EXPIRY ?? 2_592_000) * 1000,
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken } = await this.authService.login(
      dto.identifier,
      dto.password,
      dto.role,
    );
    res.cookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTIONS);
    return { accessToken };
  }
  
  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawRefreshToken = (req.cookies as Record<string, string>)?.['refresh_token'];
    await this.authService.logout(user.sub, user.jti, rawRefreshToken);
    res.clearCookie('refresh_token');
    return { success: true };
  }

  @Public()
  @Get('session')
  async session(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    console.log('Cookies', req.cookies)
    const accessToken = req.cookies?.google_handoff;
    if (!accessToken) {
      throw new UnauthorizedException();
    }
    res.clearCookie('google_handoff', { path: '/' }); // one-time use
    return { success: true, data: { accessToken } };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawToken = req.cookies?.refresh_token;
    if (!rawToken) {
      throw new UnauthorizedException();
    }

    const { accessToken, refreshToken } = await this.authService.refresh(rawToken);

    // rotate: issue a new refresh_token and invalidate the old one
    res.cookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTIONS);

    return { success: true, data: { accessToken } };
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    const valid = await this.authService.verifyOtp(dto.identifier, dto.code);
    if (!valid) throw new BadRequestException('Invalid or expired code');
    return { verified: true };
  }

  @Public()
  @Throttle({ medium: { limit: 3, ttl: 600_000 } })
  @Post('otp/resend')
  @HttpCode(HttpStatus.OK)
  async resendOtp(@Body() dto: ResendOtpDto) {
    await this.authService.sendOtp(dto.identifier);
    return { sent: true };
  }


  @Public()
  @Post(['password/reset-request', 'password/forgot'])
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    const identifier = dto.identifier || dto.email;
    if (!identifier) {
      throw new BadRequestException('Identifier or email is required');
    }
    await this.authService.requestPasswordReset(identifier);
    return { sent: true };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto);
    return { success: true };
  }

  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() {
    // Passport redirects to Google — no body needed
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const googleUser = req.user as { googleSub: string; email: string };
    const { accessToken, refreshToken } = await this.authService.loginWithGoogle(
      googleUser.googleSub,
      googleUser.email,
    );
    res.cookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTIONS);
    res.cookie('google_handoff', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',   // must be 'lax', not 'strict' — this cookie needs to survive the redirect back from Google
      maxAge: 60_000,     // short-lived, only exists to get the token to the one /users/me call
      path: '/',
    });

    const state = req.query['state'] as string | undefined;
    const targetFrontend = state === 'worker' ? process.env.WORKER_URL : process.env.CLIENT_URL;

    return res.redirect(`${targetFrontend}/login/google-callback`);
  }
}
