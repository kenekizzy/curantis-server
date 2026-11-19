import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { WorkersController } from './workers.controller.js';
import { WorkersService } from './workers.service.js';
import { WorkerAccountController } from './worker-account.controller.js';

@Module({
  imports: [PaymentsModule],
  controllers: [WorkersController, WorkerAccountController],
  providers: [WorkersService],
})
export class WorkersModule {}
