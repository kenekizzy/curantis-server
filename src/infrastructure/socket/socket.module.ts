import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SocketGateway } from './socket.gateway.js';
import { ChatModule } from '../../modules/chat/chat.module.js';

@Module({
  imports: [
    JwtModule.register({}),
    ChatModule,
  ],
  providers: [SocketGateway],
  exports: [SocketGateway],
})
export class SocketModule {}
