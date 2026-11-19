import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../../common/types/jwt-payload.type.js';
import { VerificationService } from './verification.service.js';
import { SubmitIdentityDto } from './dto/submit-identity.dto.js';
import { SubmitCredentialDto } from './dto/submit-credential.dto.js';

@ApiTags('verification')
@ApiBearerAuth()
@Controller('verification')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  @Roles(Role.HW, Role.HS)
  @Post('identity')
  submitIdentity(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SubmitIdentityDto,
  ) {
    return this.verificationService.submitIdentity(user.sub, dto);
  }

  @Roles(Role.HW, Role.HS)
  @Get('identity/status')
  getStatus(@CurrentUser() user: JwtPayload) {
    return this.verificationService.getStatus(user.sub);
  }

  @Roles(Role.HW)
  @Post('credentials')
  submitCredential(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SubmitCredentialDto,
  ) {
    return this.verificationService.submitCredential(user.sub, dto, user.role);
  }

  @Roles(Role.HW)
  @Get('credentials')
  listCredentials(@CurrentUser() user: JwtPayload) {
    return this.verificationService.listCredentials(user.sub);
  }

  @Roles(Role.HW)
  @Delete('credentials/:id')
  deleteCredential(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.verificationService.deleteCredential(user.sub, id);
  }
}
