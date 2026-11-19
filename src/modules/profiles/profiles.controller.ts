import { Controller, Get, Put, Patch, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { ProfilesService } from './profiles.service.js';
import { CreateWorkerProfileDto } from './dto/create-worker-profile.dto.js';
import { CreateClientProfileDto } from './dto/create-client-profile.dto.js';
import { UpdateWorkerProfileDto } from './dto/update-worker-profile.dto.js';
import { UpdateClientProfileDto } from './dto/update-client-profile.dto.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import type { JwtPayload } from '../../common/types/jwt-payload.type.js';

@ApiTags('profiles')
@ApiBearerAuth()
@Controller('users')
export class ProfilesController {
  constructor(private readonly profilesService: ProfilesService) {}

  // ── Own profile ──────────────────────────────────────────────

  @Get('me/profile')
  async getOwnProfile(@CurrentUser() user: JwtPayload) {
    return this.profilesService.getOwnProfile(user.sub, user.role);
  }

  @Put('me/profile')
  async upsertProfile(
    @CurrentUser() user: JwtPayload,
    @Body() body: Record<string, unknown>,
  ) {
    if (user.role === Role.CLIENT) {
      return this.profilesService.upsertClientProfile(
        user.sub,
        body as unknown as CreateClientProfileDto,
      );
    }
    return this.profilesService.upsertWorkerProfile(
      user.sub,
      body as unknown as CreateWorkerProfileDto,
    );
  }

  @Patch('me/profile')
  async patchProfile(
    @CurrentUser() user: JwtPayload,
    @Body() body: Record<string, unknown>,
  ) {
    if (user.role === Role.CLIENT) {
      return this.profilesService.patchClientProfile(
        user.sub,
        body as unknown as UpdateClientProfileDto,
      );
    }
    return this.profilesService.patchWorkerProfile(
      user.sub,
      body as unknown as UpdateWorkerProfileDto,
    );
  }

  // ── Public worker profile — declared after me/* to avoid :id matching "me" ──

  @Roles(Role.CLIENT)
  @Get(':id/profile')
  async getPublicProfile(@Param('id') id: string) {
    return this.profilesService.getPublicWorkerProfile(id);
  }
}
