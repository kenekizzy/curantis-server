import { BookingStatus } from '@prisma/client';
import { BookingsCron } from './bookings.cron.js';

// ⏰ What is this file checking?
// Sometimes a worker forgets to tap "complete" after finishing a job.
// This cron job runs once an hour and is the app's safety net: any
// booking that's still "IN_PROGRESS" more than 2 hours after it was
// supposed to end gets auto-completed, so escrow can still be released
// and nobody's payment is stuck in limbo forever.

describe('BookingsCron', () => {
  function buildCron() {
    const prisma = {
      booking: { findMany: jest.fn(), update: jest.fn() },
      bookingLog: { create: jest.fn() },
    } as any;
    const eventEmitter = { emit: jest.fn() } as any;
    return { cron: new BookingsCron(prisma, eventEmitter), prisma, eventEmitter };
  }

  it('does nothing when there are no overdue bookings', async () => {
    // Why: the common case, every hour — nothing stuck, nothing to do.
    const { cron, prisma } = buildCron();
    prisma.booking.findMany.mockResolvedValue([]);

    await cron.autoCompleteOverdueBookings();

    expect(prisma.booking.update).not.toHaveBeenCalled();
  });

  it('auto-completes every overdue booking, logs it, and announces completion for each one', async () => {
    // Why: two stuck bookings should each get their own log entry and event —
    // one shouldn't silently swallow the other.
    const { cron, prisma, eventEmitter } = buildCron();
    prisma.booking.findMany.mockResolvedValue([
      { id: 'b1', workerId: 'w1', clientId: 'c1', workerAmountKobo: 100n },
      { id: 'b2', workerId: 'w2', clientId: 'c2', workerAmountKobo: 200n },
    ]);

    await cron.autoCompleteOverdueBookings();

    expect(prisma.booking.update).toHaveBeenCalledTimes(2);
    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'b1' },
        data: expect.objectContaining({ status: BookingStatus.COMPLETED }),
      }),
    );
    expect(prisma.bookingLog.create).toHaveBeenCalledTimes(2);
    expect(eventEmitter.emit).toHaveBeenCalledTimes(2);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'booking.completed',
      expect.objectContaining({ bookingId: 'b1', workerAmountKobo: 100n }),
    );
  });

  it('only ever looks at bookings that are still IN_PROGRESS', async () => {
    // Why: a COMPLETED or CANCELLED booking should never be touched by this job.
    const { cron, prisma } = buildCron();
    prisma.booking.findMany.mockResolvedValue([]);

    await cron.autoCompleteOverdueBookings();

    expect(prisma.booking.findMany.mock.calls[0][0].where.status).toBe(BookingStatus.IN_PROGRESS);
  });
});
