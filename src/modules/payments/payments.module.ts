import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PaymentsService } from './payments.service.js';
import { PaymentsListener } from './payments.listener.js';
import { PaymentsController } from './payments.controller.js';
import { PayoutsProcessor } from './processors/payouts.processor.js';
import { PaystackWebhookController } from './webhooks/paystack.webhook.js';
import { FlutterwaveWebhookController } from './webhooks/flutterwave.webhook.js';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'payouts',
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'fixed', delay: 3_600_000 },
      },
    }),
  ],
  controllers: [PaymentsController, PaystackWebhookController, FlutterwaveWebhookController],
  providers: [PaymentsService, PaymentsListener, PayoutsProcessor],
  exports: [PaymentsService],
})
export class PaymentsModule {}
