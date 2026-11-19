import { Controller, Post, Req, Headers, BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import * as crypto from 'crypto';
import { Public } from '../../../common/decorators/public.decorator.js';
import { PaymentsService } from '../payments.service.js';

@Controller('payments/webhooks')
export class PaystackWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Public()
  @Post('paystack')
  async handle(
    @Req() req: Request,
    @Headers('x-paystack-signature') signature: string,
  ): Promise<{ received: boolean }> {
    const rawBody = req.body as Buffer;

    const webhookSecret =
      process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY || '';
    const hash = crypto
      .createHmac('sha512', webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (hash !== signature) throw new BadRequestException('Invalid webhook signature');

    const event = JSON.parse(rawBody.toString()) as {
      event: string;
      data: Record<string, unknown>;
    };

    if (event.event === 'charge.success') {
      const reference = event.data['reference'] as string;
      await this.paymentsService.handlePaymentSuccess(reference, event.data);
    }

    return { received: true };
  }
}
