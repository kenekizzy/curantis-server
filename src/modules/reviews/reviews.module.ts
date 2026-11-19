import { Module } from '@nestjs/common';
import { ReviewsService } from './reviews.service.js';
import { ReviewsController } from './reviews.controller.js';
import { ReviewsCron } from './reviews.cron.js';

@Module({
  controllers: [ReviewsController],
  providers: [ReviewsService, ReviewsCron],
})
export class ReviewsModule {}
