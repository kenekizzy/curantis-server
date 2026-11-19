import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { RedisService } from '../redis/redis.service.js';
import { ChatService } from '../../modules/chat/chat.service.js';
import type { JwtPayload } from '../../common/types/jwt-payload.type.js';

interface AuthenticatedSocket extends Socket {
  data: { userId: string; role: string };
}

interface JoinDto { conversationId: string; }
interface SendDto { conversationId: string; text?: string; fileUrl?: string; fileType?: string; fileName?: string; }
interface ReadDto { conversationId: string; lastReadAt?: string; }

@WebSocketGateway({
  cors: {
    origin: [
      process.env.CLIENT_URL ?? '',
      process.env.WORKER_URL ?? '',
      process.env.ADMIN_URL ?? '',
    ],
    credentials: true,
  },
  namespace: '/chat',
})
@Injectable()
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
    private readonly chatService: ChatService,
  ) {}

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      const token = client.handshake.auth?.token as string | undefined;
      if (!token) { client.disconnect(); return; }

      const payload = this.jwtService.verify<JwtPayload>(token, {
        publicKey: process.env.JWT_PUBLIC_KEY!.replace(/\\n/g, '\n'),
        algorithms: ['RS256'],
      });

      client.data.userId = payload.sub;
      client.data.role = payload.role;

      await client.join(`user:${payload.sub}`);
      await this.redis.setex(`presence:${payload.sub}`, 90, 'online');
      this.server.emit('chat:presence', { userId: payload.sub, status: 'online' });
    } catch {
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket): Promise<void> {
    if (!client.data?.userId) return;
    await this.redis.del(`presence:${client.data.userId}`);
    this.server.emit('chat:presence', { userId: client.data.userId, status: 'offline' });
  }

  @SubscribeMessage('chat:join')
  async handleJoin(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: JoinDto,
  ): Promise<{ error: string } | undefined> {
    const allowed = await this.chatService.canAccess(client.data.userId, dto.conversationId);
    if (!allowed) return { error: 'FORBIDDEN' };

    await client.join(`conv:${dto.conversationId}`);
    const messages = await this.chatService.getHistory(dto.conversationId, 50);
    client.emit('chat:history', { messages });
    await this.chatService.markRead(dto.conversationId, client.data.userId);
    return undefined;
  }

  @SubscribeMessage('chat:send')
  async handleSend(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: SendDto,
  ): Promise<{ error: string } | undefined> {
    const allowed = await this.chatService.canAccess(client.data.userId, dto.conversationId);
    if (!allowed) return { error: 'FORBIDDEN' };

    const message = await this.chatService.persistMessage({
      conversationId: dto.conversationId,
      senderId: client.data.userId,
      text: dto.text,
      fileUrl: dto.fileUrl,
      fileType: dto.fileType,
      fileName: dto.fileName,
    });

    this.server.to(`conv:${dto.conversationId}`).emit('chat:message', { message });
    client.emit('chat:message:ack', { messageId: message.id, sentAt: message.createdAt });
    return undefined;
  }

  @SubscribeMessage('chat:typing')
  handleTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: JoinDto,
  ): void {
    client.to(`conv:${dto.conversationId}`).emit('chat:typing', {
      userId: client.data.userId,
      conversationId: dto.conversationId,
    });
  }

  @SubscribeMessage('chat:read')
  async handleRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() dto: ReadDto,
  ): Promise<void> {
    await this.chatService.markRead(dto.conversationId, client.data.userId, dto.lastReadAt);
    client.to(`conv:${dto.conversationId}`).emit('chat:read', {
      userId: client.data.userId,
      conversationId: dto.conversationId,
      lastReadAt: dto.lastReadAt,
    });
  }

  @SubscribeMessage('chat:heartbeat')
  async handleHeartbeat(@ConnectedSocket() client: AuthenticatedSocket): Promise<void> {
    await this.redis.setex(`presence:${client.data.userId}`, 90, 'online');
  }
}
