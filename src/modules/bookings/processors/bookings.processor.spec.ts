import { BookingStatus } from '@prisma/client';
import { BookingsProcessor } from './bookings.processor.js';

// 🤖 What is this file checking?
// When a client sends a booking request, a 2-hour timer starts ticking
// in the background (a BullMQ job). If the worker never responds, this
// processor is the one that actually fires and auto-declines the booking
// on the client's behalf — nobody should be left waiting forever.
// The key safety check: if the worker DID respond in time (accepted or
// declined already), this job must do absolutely nothing.

describe('BookingsProcessor', () => {
  function buildProcessor() {
    const prisma = { booking: { findUnique: jest.fn(), update: jest.fn() } } as any;
    const eventEmitter = { emit: jest.fn() } as any;
    return { processor: new BookingsProcessor(prisma, eventEmitter), prisma, eventEmitter };
  }

  it('does nothing if the booking was already accepted/declined before the timer fired', async () => {
    // Why: the worker responded in time — the auto-decline job is now stale and must be a no-op.
    const { processor, prisma } = buildProcessor();
    prisma.booking.findUnique.mockResolvedValue({ id: 'b1', status: BookingStatus.ACCEPTED });

    await processor.process({ name: 'auto-decline', data: { bookingId: 'b1' } } as any);

    expect(prisma.booking.update).not.toHaveBeenCalled();
  });

  it('auto-declines the booking on the system\'s behalf when nobody responded in time', async () => {
    // Why: this is the whole point of the job — silence for 2 hours = auto-decline.
    const { processor, prisma, eventEmitter } = buildProcessor();
    prisma.booking.findUnique.mockResolvedValue({
      id: 'b1',
      status: BookingStatus.PENDING,
      clientId: 'client-1',
    });

    await processor.process({ name: 'auto-decline', data: { bookingId: 'b1' } } as any);

    expect(prisma.booking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'b1' },
        data: expect.objectContaining({ status: BookingStatus.CANCELLED, cancelledBy: 'SYSTEM' }),
      }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith('booking.auto_declined', {
      bookingId: 'b1',
      clientId: 'client-1',
    });
  });

  it('ignores job types it does not recognise', async () => {
    // Why: this processor is wired to the whole "bookings" queue — it must
    // only react to jobs named "auto-decline" and leave everything else alone.
    const { processor, prisma } = buildProcessor();

    await processor.process({ name: 'something-else', data: {} } as any);

    expect(prisma.booking.findUnique).not.toHaveBeenCalled();
  });
});
