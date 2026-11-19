import { Controller, Post, Req, Headers, BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../../common/decorators/public.decorator.js';
import { PaymentsService } from '../payments.service.js';

@Controller('payments/webhooks')
export class FlutterwaveWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Public()
  @Post('flutterwave')
  async handle(
    @Req() req: Request,
    @Headers('verif-hash') hash: string,
  ): Promise<{ received: boolean }> {
    if (hash !== process.env.FLUTTERWAVE_WEBHOOK_HASH) {
      throw new BadRequestException('Invalid webhook signature');
    }

    const event = JSON.parse((req.body as Buffer).toString()) as {
      event: string;
      data: Record<string, unknown>;
    };

    if (event.event === 'charge.completed' && event.data['status'] === 'successful') {
      const reference = event.data['tx_ref'] as string;
      await this.paymentsService.handlePaymentSuccess(reference, event.data);
    }

    return { received: true };
  }
}
