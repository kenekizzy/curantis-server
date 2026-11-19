import { Controller, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { Role, UserStatus } from '@prisma/client';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { AdminRoles } from '../../../common/decorators/admin-role.decorator.js';
import { AdminRolesGuard } from '../../../common/guards/admin-roles.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../../../common/types/jwt-payload.type.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { AdminLoggerService } from '../services/admin-logger.service.js';

class UpdateUserStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED', 'DEACTIVATED'])
  status!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@UseGuards(AdminRolesGuard)
@Controller('admin/users')
export class AdminUsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminLogger: AdminLoggerService,
  ) {}

  @Get()
  list(@Query('role') role?: string, @Query('status') status?: string) {
    return this.prisma.user.findMany({
      where: {
        ...(role ? { role: role as Role } : {}),
        ...(status ? { status: status as UserStatus } : {}),
      },
      select: {
        id: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        emailVerified: true,
        phoneVerified: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @AdminRoles('SUPER_ADMIN', 'SUPPORT_AGENT')
  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateUserStatusDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    const updated = await this.prisma.user.update({
      where: { id },
      data: { status: dto.status as UserStatus },
      select: { id: true, status: true },
    });
    await this.adminLogger.log(admin.sub, `USER_${dto.status}`, 'user', id, dto.reason);
    return updated;
  }
}
