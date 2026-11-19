import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { BookingsProcessor } from './processors/bookings.processor.js';
import { BookingsCron } from './bookings.cron.js';

@Module({
  imports: [BullModule.registerQueue({ name: 'bookings' })],
  controllers: [BookingsController],
  providers: [BookingsService, BookingsProcessor, BookingsCron],
  exports: [BookingsService],
})
export class BookingsModule {}
