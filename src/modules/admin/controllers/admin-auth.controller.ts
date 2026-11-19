import {
  Controller,
  Post,
  Body,
  Res,
  Delete,
  Patch,
  HttpCode,
  HttpStatus,
  Param,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthService } from '../../auth/auth.service.js';
import { LoginDto } from '../../auth/dto/login.dto.js';
import { CreateAdminDto } from '../../auth/dto/create-admin.dto.js';
import { UpdateAdminPasswordDto } from '../../auth/dto/update-admin-password.dto.js';
import { Public } from '../../../common/decorators/public.decorator.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../../../common/types/jwt-payload.type.js';
import { AdminRole } from '@prisma/client';
import { AdminRoles } from '../../../common/decorators/admin-role.decorator.js';
import { RequestPasswordResetDto } from '../../auth/dto/reset-password.dto.js';
import { ResetPasswordDto } from '../../auth/dto/reset-password.dto.js';

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: Number(process.env.JWT_REFRESH_EXPIRY ?? 2_592_000) * 1000,
};

@ApiTags('admin')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly authService: AuthService) { }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { accessToken, refreshToken, adminRole } =
      await this.authService.loginAdmin(dto.identifier, dto.password);

    res.cookie('refresh_token', refreshToken, REFRESH_COOKIE_OPTIONS);

    return { accessToken, adminRole };
  }

  @AdminRoles('SUPER_ADMIN')
  @Post('create-admin')
  @HttpCode(HttpStatus.CREATED)
  async createAdmin(
    @Body() dto: CreateAdminDto,
    @CurrentUser() admin: JwtPayload
  ) {
    await this.authService.createNewAdmin(admin.sub, dto.email, dto.password, dto.role);

    return { success: true };
  }

  @AdminRoles('SUPER_ADMIN', 'VERIFICATION_OFFICER', 'SUPPORT_AGENT', 'FINANCE_OFFICER')
  @Patch("update-admin-password")
  @HttpCode(HttpStatus.OK)
  async updateAdminPassword(
    @Body() dto: UpdateAdminPasswordDto,
    @CurrentUser() admin: JwtPayload
  ) {
    await this.authService.updateAdminPassword(admin.sub, dto.email, dto.newPassword, dto.oldPassword);
    return { success: true };
  }

  @Public()
  @Post('password/reset-request')
  @HttpCode(HttpStatus.OK)
  async requestPasswordReset(@Body() dto: RequestPasswordResetDto) {
    const identifier = (dto.identifier || dto.email) ?? '';
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

  @AdminRoles('SUPER_ADMIN')
@Delete('delete-admin/:adminId')
@HttpCode(HttpStatus.OK)
async deleteAdmin(
  @Param('adminId') adminId: string,
  @CurrentUser() admin: JwtPayload,
) {
  await this.authService.deleteAdmin(
    admin.sub,
    adminId,
  );

  return { success: true };
}

  @AdminRoles('SUPER_ADMIN')
  @Patch('update-admin-role/:adminId')
  @HttpCode(HttpStatus.OK)
  async updateAdminRole(
    @Body() dto: { adminId: string, role: AdminRole }
  ) {
    await this.authService.updateAdminRole(dto.adminId, dto.role);

    return { success: true };
  }
}
