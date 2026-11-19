import { Controller, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { AdminRoles } from '../../../common/decorators/admin-role.decorator.js';
import { AdminRolesGuard } from '../../../common/guards/admin-roles.guard.js';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../../../common/types/jwt-payload.type.js';
import { AdminVerificationsService } from '../services/admin-verifications.service.js';
import { AdminLoggerService } from '../services/admin-logger.service.js';

class ReviewVerificationDto {
  @IsIn(['approve', 'reject', 'request_docs'])
  decision!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@UseGuards(AdminRolesGuard)
@Controller('admin/verifications')
export class AdminVerificationsController {
  constructor(
    private readonly verificationsService: AdminVerificationsService,
    private readonly adminLogger: AdminLoggerService,
  ) {}

  @Get()
  queue(@Query('status') status?: string) {
    return this.verificationsService.getQueue(status);
  }

  @AdminRoles('SUPER_ADMIN', 'VERIFICATION_OFFICER')
  @Patch(':id')
  async review(
    @Param('id') id: string,
    @Body() dto: ReviewVerificationDto,
    @CurrentUser() admin: JwtPayload,
  ) {
    const result = await this.verificationsService.review(id, dto.decision, dto.note, admin.sub);
    await this.adminLogger.log(
      admin.sub,
      `VERIFICATION_${dto.decision.toUpperCase()}`,
      'verification',
      id,
      dto.note,
    );
    return result;
  }
}
