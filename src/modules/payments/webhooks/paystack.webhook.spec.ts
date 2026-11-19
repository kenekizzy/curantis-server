import * as crypto from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { PaystackWebhookController } from './paystack.webhook.js';

// ✍️ What is this file checking?
// Anyone on the internet can send a POST request pretending to be
// Paystack telling us "this payment succeeded!" — so before we believe
// ANY webhook, we check its signature: a secret code Paystack signs the
// message with, using a key only Paystack and our server know. If the
// signature doesn't match exactly, we must refuse to trust the message,
// no matter how convincing it looks.

function sign(body: Buffer, secret: string): string {
  return crypto.createHmac('sha512', secret).update(body).digest('hex');
}

describe('PaystackWebhookController', () => {
  beforeEach(() => {
    process.env.PAYSTACK_WEBHOOK_SECRET = 'webhook-secret';
  });

  function buildController() {
    const paymentsService = { handlePaymentSuccess: jest.fn() } as any;
    return { controller: new PaystackWebhookController(paymentsService), paymentsService };
  }

  it('refuses a webhook whose signature does not match (could be a forged request)', async () => {
    // Why: this is the whole security boundary of the endpoint.
    const { controller } = buildController();
    const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: {} }));

    await expect(
      controller.handle({ body } as any, 'not-the-real-signature'),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a correctly signed "charge.success" event and confirms the payment', async () => {
    // Why: this is the real, legitimate case — Paystack telling us money arrived.
    const { controller, paymentsService } = buildController();
    const payload = { event: 'charge.success', data: { reference: 'cgn_booking-1_123' } };
    const body = Buffer.from(JSON.stringify(payload));
    const signature = sign(body, 'webhook-secret');

    const result = await controller.handle({ body } as any, signature);

    expect(paymentsService.handlePaymentSuccess).toHaveBeenCalledWith(
      'cgn_booking-1_123',
      payload.data,
    );
    expect(result).toEqual({ received: true });
  });

  it('acknowledges but ignores event types we do not care about', async () => {
    // Why: Paystack sends many event types — we only act on charge.success,
    // but we should still politely say "received" for everything else.
    const { controller, paymentsService } = buildController();
    const payload = { event: 'transfer.success', data: {} };
    const body = Buffer.from(JSON.stringify(payload));
    const signature = sign(body, 'webhook-secret');

    const result = await controller.handle({ body } as any, signature);

    expect(paymentsService.handlePaymentSuccess).not.toHaveBeenCalled();
    expect(result).toEqual({ received: true });
  });
});
