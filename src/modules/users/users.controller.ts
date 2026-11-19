import { Controller, Get, Patch, Post, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../../common/types/jwt-payload.type.js';
import { UsersService } from './users.service.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { AvatarUploadDto } from './dto/avatar-upload.dto.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';

const ALLOWED_AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5MB
const AVATAR_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly storageService: StorageService,
  ) {}

  @Get('me')
  async getMe(@CurrentUser() user: JwtPayload) {
    return this.usersService.findById(user.sub);
  }

  @Patch('me')
  async updateMe(@CurrentUser() user: JwtPayload, @Body() dto: UpdateUserDto) {
    return this.usersService.update(user.sub, dto);
  }

  @Post('me/avatar')
  async getAvatarUploadUrl(
    @CurrentUser() user: JwtPayload,
    @Body() dto: AvatarUploadDto,
  ) {
    const ext = AVATAR_EXTENSIONS[dto.mimeType] ?? 'jpg';
    return this.storageService.getUploadSignature({
      folder: 'avatars',
      mimeType: dto.mimeType,
      fileSize: dto.fileSize,
      allowedMimeTypes: ALLOWED_AVATAR_TYPES,
      maxSizeBytes: MAX_AVATAR_SIZE,
      publicId: this.storageService.buildPublicId(user.sub, `avatar.${ext}`),
    });
  }
}
