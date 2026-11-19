import { BadRequestException } from '@nestjs/common';
import { FlutterwaveWebhookController } from './flutterwave.webhook.js';

// ✍️ What is this file checking?
// Same idea as the Paystack webhook, but Flutterwave uses a simpler
// scheme: it just sends back a fixed secret hash in a header, and we
// compare it directly to the one we configured. If it doesn't match
// exactly, we can't trust the request.

describe('FlutterwaveWebhookController', () => {
  beforeEach(() => {
    process.env.FLUTTERWAVE_WEBHOOK_HASH = 'expected-hash';
  });

  function buildController() {
    const paymentsService = { handlePaymentSuccess: jest.fn() } as any;
    return { controller: new FlutterwaveWebhookController(paymentsService), paymentsService };
  }

  it('refuses a webhook whose verif-hash header does not match our configured secret', async () => {
    const { controller } = buildController();
    const body = Buffer.from(JSON.stringify({ event: 'charge.completed', data: {} }));

    await expect(controller.handle({ body } as any, 'wrong-hash')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('confirms the payment for a successfully completed charge with the right hash', async () => {
    const { controller, paymentsService } = buildController();
    const payload = {
      event: 'charge.completed',
      data: { status: 'successful', tx_ref: 'cgn_booking-1_123' },
    };
    const body = Buffer.from(JSON.stringify(payload));

    const result = await controller.handle({ body } as any, 'expected-hash');

    expect(paymentsService.handlePaymentSuccess).toHaveBeenCalledWith(
      'cgn_booking-1_123',
      payload.data,
    );
    expect(result).toEqual({ received: true });
  });

  it('does not confirm the payment when the charge event says the status was not "successful"', async () => {
    // Why: a "charge.completed" event can still mean the charge failed —
    // we must check the status field, not just the event name.
    const { controller, paymentsService } = buildController();
    const payload = { event: 'charge.completed', data: { status: 'failed', tx_ref: 'x' } };
    const body = Buffer.from(JSON.stringify(payload));

    await controller.handle({ body } as any, 'expected-hash');

    expect(paymentsService.handlePaymentSuccess).not.toHaveBeenCalled();
  });
});
