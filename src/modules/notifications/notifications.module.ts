import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsService } from './notifications.service.js';
import { NotificationsListener } from './notifications.listener.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsProcessor } from './processors/notifications.processor.js';

import { MailModule } from '../mail/mail.module.js';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'notifications',
      defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5_000 } },
    }),
    MailModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsListener, NotificationsProcessor],
})
export class NotificationsModule {}
