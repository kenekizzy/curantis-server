import { Controller, Get, Delete, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { AdminRoles } from '../../../common/decorators/admin-role.decorator.js';
import { AdminRolesGuard } from '../../../common/guards/admin-roles.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../../../common/types/jwt-payload.type.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { AdminLoggerService } from '../services/admin-logger.service.js';

class RemoveReviewDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@UseGuards(AdminRolesGuard)
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminLogger: AdminLoggerService,
  ) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.prisma.review.findMany({
      where: status ? { status: status as 'PUBLISHED' | 'FLAGGED' | 'REMOVED' } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @AdminRoles('SUPER_ADMIN', 'SUPPORT_AGENT')
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Body() dto: RemoveReviewDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    const updated = await this.prisma.review.update({
      where: { id },
      data: { status: 'REMOVED', removedReason: dto.reason },
    });
    await this.adminLogger.log(admin.sub, 'REVIEW_REMOVED', 'review', id, dto.reason);
    return updated;
  }

  @AdminRoles('SUPER_ADMIN', 'SUPPORT_AGENT')
  @Patch(':id/restore')
  async restore(@Param('id') id: string, @CurrentUser() admin: JwtPayload) {
    const updated = await this.prisma.review.update({
      where: { id },
      data: { status: 'PUBLISHED', removedReason: null },
    });
    await this.adminLogger.log(admin.sub, 'REVIEW_RESTORED', 'review', id);
    return updated;
  }
}
