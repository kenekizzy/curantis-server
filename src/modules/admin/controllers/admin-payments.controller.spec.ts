import { AdminPaymentsController } from './admin-payments.controller.js';

// 💰 What is this file checking?
// The admin's financial control panel: issuing refunds and manually
// releasing a worker's payout early. Both actions are powerful, so both
// must always leave an audit trail behind via AdminLoggerService.

describe('AdminPaymentsController', () => {
  function buildController() {
    const prisma = { payment: { findMany: jest.fn() }, booking: { findMany: jest.fn(), findUnique: jest.fn() } } as any;
    const paymentsService = { issueRefund: jest.fn() } as any;
    const adminLogger = { log: jest.fn() } as any;
    const payoutsQueue = { add: jest.fn() } as any;
    return {
      controller: new AdminPaymentsController(prisma, paymentsService, adminLogger, payoutsQueue),
      prisma,
      paymentsService,
      adminLogger,
      payoutsQueue,
    };
  }

  const admin = { sub: 'admin-1' } as any;

  describe('refund', () => {
    it('issues the refund through PaymentsService and logs the admin action', async () => {
      const { controller, paymentsService, adminLogger } = buildController();
      paymentsService.issueRefund.mockResolvedValue({ id: 'refund-1' });

      await controller.refund('payment-1', { amountKobo: '500000', reason: 'client complaint' }, admin);

      expect(paymentsService.issueRefund).toHaveBeenCalledWith('payment-1', 500_000n, 'client complaint');
      expect(adminLogger.log).toHaveBeenCalledWith(
        'admin-1',
        'REFUND_ISSUED',
        'payment',
        'payment-1',
        'client complaint',
      );
    });
  });

  describe('releasePayout', () => {
    it('returns an error object (not a thrown exception) when the booking does not exist', async () => {
      // Why: this endpoint intentionally responds with a plain error object here.
      const { controller, prisma, payoutsQueue } = buildController();
      prisma.booking.findUnique.mockResolvedValue(null);

      const result = await controller.releasePayout('ghost', {}, admin);

      expect(result).toEqual({ error: 'Booking not found' });
      expect(payoutsQueue.add).not.toHaveBeenCalled();
    });

    it('queues the escrow release and logs the manual override', async () => {
      const { controller, prisma, payoutsQueue, adminLogger } = buildController();
      prisma.booking.findUnique.mockResolvedValue({ workerId: 'worker-1', workerAmountKobo: 900_000n });

      const result = await controller.releasePayout('booking-1', { reason: 'goodwill' }, admin);

      expect(payoutsQueue.add).toHaveBeenCalledWith('release-escrow', {
        bookingId: 'booking-1',
        workerId: 'worker-1',
        amountKobo: '900000',
      });
      expect(adminLogger.log).toHaveBeenCalledWith(
        'admin-1',
        'PAYOUT_MANUAL_RELEASE',
        'booking',
        'booking-1',
        'goodwill',
      );
      expect(result).toEqual({ queued: true });
    });
  });
});
