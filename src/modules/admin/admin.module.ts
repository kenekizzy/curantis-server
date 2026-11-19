import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AdminLoggerService } from './services/admin-logger.service.js';
import { AdminVerificationsService } from './services/admin-verifications.service.js';
import { AdminUsersController } from './controllers/admin-users.controller.js';
import { AdminVerificationsController } from './controllers/admin-verifications.controller.js';
import { AdminBookingsController } from './controllers/admin-bookings.controller.js';
import { AdminPaymentsController } from './controllers/admin-payments.controller.js';
import { AdminReviewsController } from './controllers/admin-reviews.controller.js';
import { AdminReportsController } from './controllers/admin-reports.controller.js';
import { AdminAnalyticsController } from './controllers/admin-analytics.controller.js';
import { AdminAuthController } from './controllers/admin-auth.controller.js';
import { AdminDisputesController } from './controllers/admin-disputes.controller.js';
import { AdminPayoutsController } from './controllers/admin-payouts.controller.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [
    PaymentsModule,
    AuthModule,
    BullModule.registerQueue({ name: 'payouts' }),
  ],
  controllers: [
    AdminAuthController,
    AdminUsersController,
    AdminVerificationsController,
    AdminBookingsController,
    AdminPaymentsController,
    AdminDisputesController,
    AdminPayoutsController,
    AdminReviewsController,
    AdminReportsController,
    AdminAnalyticsController,
  ],
  providers: [AdminLoggerService, AdminVerificationsService],
})
export class AdminModule {}
