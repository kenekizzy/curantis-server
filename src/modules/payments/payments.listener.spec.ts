import { PaymentsListener } from './payments.listener.js';

// ⏳ What is this file checking?
// When a booking is marked "completed", the money doesn't go to the
// worker immediately — it waits in escrow for 24 hours, in case the
// client needs to raise a dispute. This listener is what starts that
// 24-hour timer, and it's also what CANCELS the timer if a dispute
// comes in before the money would have gone out.

describe('PaymentsListener', () => {
  function buildListener() {
    const payoutsQueue = { add: jest.fn(), getJob: jest.fn() } as any;
    return { listener: new PaymentsListener(payoutsQueue), payoutsQueue };
  }

  it('schedules the payout to fire 24 hours after the booking completes', async () => {
    // Why: this is the whole point of the escrow window.
    const { listener, payoutsQueue } = buildListener();

    await listener.scheduleEscrowRelease({
      bookingId: 'b1',
      workerId: 'w1',
      workerAmountKobo: 900_000n,
    });

    expect(payoutsQueue.add).toHaveBeenCalledWith(
      'release-escrow',
      { bookingId: 'b1', workerId: 'w1', amountKobo: '900000' },
      expect.objectContaining({ delay: 24 * 3_600_000, jobId: 'escrow-release-b1' }),
    );
  });

  it('cancels the pending payout timer when a dispute is raised', async () => {
    // Why: money must not go out while a dispute about that exact booking is open.
    const { listener, payoutsQueue } = buildListener();
    const remove = jest.fn();
    payoutsQueue.getJob.mockResolvedValue({ remove });

    await listener.cancelEscrowRelease({ bookingId: 'b1' });

    expect(payoutsQueue.getJob).toHaveBeenCalledWith('escrow-release-b1');
    expect(remove).toHaveBeenCalled();
  });

  it('does nothing if there was no pending payout job to cancel', async () => {
    // Why: the dispute might come in after the payout already fired — nothing to remove.
    const { listener, payoutsQueue } = buildListener();
    payoutsQueue.getJob.mockResolvedValue(null);

    await expect(listener.cancelEscrowRelease({ bookingId: 'b1' })).resolves.not.toThrow();
  });
});
