import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { IsString, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { RedisService } from '../../infrastructure/redis/redis.service.js';
import { ChatService } from './chat.service.js';

class UploadAttachmentDto {
  @IsString()
  conversationId!: string;

  @IsString()
  mimeType!: string;

  @IsNumber()
  @Type(() => Number)
  fileSize!: number;

  @IsString()
  filename!: string;
}

@ApiTags('chat')
@ApiBearerAuth()
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly redis: RedisService,
  ) {}

  @Get(':id/messages')
  getMessages(
    @Param('id') conversationId: string,
    @Query('limit') limit = '50',
  ) {
    return this.chatService.getHistory(conversationId, Number(limit));
  }

  @Post('upload')
  uploadFile(@Body() dto: UploadAttachmentDto) {
    return this.chatService.uploadAttachment(
      dto.conversationId,
      dto.mimeType,
      dto.fileSize,
      dto.filename,
    );
  }

  @Get('presence/:userId')
  async getPresence(@Param('userId') userId: string) {
    const status = await this.redis.get(`presence:${userId}`);
    return { userId, status: status ?? 'offline' };
  }
}
