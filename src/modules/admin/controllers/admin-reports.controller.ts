import { Controller, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
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

class UpdateReportDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  outcome?: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@UseGuards(AdminRolesGuard)
@Controller('admin/reports')
export class AdminReportsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly adminLogger: AdminLoggerService,
  ) {}

  @Get()
  list(@Query('status') status?: string, @Query('category') category?: string) {
    return this.prisma.report.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(category ? { category } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  @AdminRoles('SUPER_ADMIN', 'SUPPORT_AGENT')
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateReportDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    const updated = await this.prisma.report.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.outcome ? { outcome: dto.outcome } : {}),
      },
    });
    await this.adminLogger.log(admin.sub, 'REPORT_UPDATED', 'report', id, dto.outcome);
    return updated;
  }
}
