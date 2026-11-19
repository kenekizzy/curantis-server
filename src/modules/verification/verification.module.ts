import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { VerificationController } from './verification.controller.js';
import { VerificationService } from './verification.service.js';

@Module({
  imports: [BullModule.registerQueue({ name: 'verification' })],
  controllers: [VerificationController],
  providers: [VerificationService],
})
export class VerificationModule {}
