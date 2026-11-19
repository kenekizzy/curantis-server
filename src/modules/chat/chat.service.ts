import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { StorageService } from '../../infrastructure/storage/storage.service.js';

const ALLOWED_CHAT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'audio/mpeg',
  'audio/ogg',
];
const MAX_CHAT_FILE_SIZE = 10 * 1024 * 1024;
const CHAT_REVIEW_WINDOW_MS = 7 * 24 * 3_600_000;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async canAccess(userId: string, conversationId: string): Promise<boolean> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) return false;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user?.role === 'ADMIN') return true;

    if (
      conversation.participantA !== userId &&
      conversation.participantB !== userId
    ) {
      return false;
    }

    if (!conversation.bookingId) return true;

    const booking = await this.prisma.booking.findUnique({
      where: { id: conversation.bookingId },
      select: { status: true, actualEnd: true },
    });
    if (!booking) return false;

    if (booking.status === 'CONFIRMED' || booking.status === 'IN_PROGRESS') return true;
    if (
      booking.status === 'COMPLETED' &&
      booking.actualEnd &&
      Date.now() - booking.actualEnd.getTime() < CHAT_REVIEW_WINDOW_MS
    ) {
      return true;
    }

    return false;
  }

  async getHistory(conversationId: string, limit: number) {
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async persistMessage(data: {
    conversationId: string;
    senderId: string;
    text?: string;
    fileUrl?: string;
    fileType?: string;
    fileName?: string;
  }) {
    return this.prisma.message.create({ data });
  }

  async markRead(conversationId: string, userId: string, lastReadAt?: string) {
    await this.prisma.message.updateMany({
      where: { conversationId, senderId: { not: userId }, readAt: null },
      data: { readAt: lastReadAt ? new Date(lastReadAt) : new Date() },
    });
  }

  async uploadAttachment(
    conversationId: string,
    mimeType: string,
    fileSize: number,
    filename: string,
  ) {
    return this.storage.getUploadSignature({
      folder: `chat/${conversationId}`,
      mimeType,
      fileSize,
      allowedMimeTypes: ALLOWED_CHAT_TYPES,
      maxSizeBytes: MAX_CHAT_FILE_SIZE,
      publicId: this.storage.buildPublicId(conversationId, filename),
    });
  }
}
