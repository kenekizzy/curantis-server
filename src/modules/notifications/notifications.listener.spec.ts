import { NotificationsListener } from './notifications.listener.js';

// 📣 What is this file checking?
// Whenever something important happens elsewhere in the app (a booking
// gets created, a payment succeeds, a dispute is resolved...), this
// listener hears about it and queues up the right notification job(s)
// for the right person. We check each event reaches the correct person
// with the correct notification "type" label.

describe('NotificationsListener', () => {
  function buildListener() {
    const notifQueue = { add: jest.fn(), addBulk: jest.fn() } as any;
    return { listener: new NotificationsListener(notifQueue), notifQueue };
  }

  it('notifies the WORKER (not the client) when a new booking request comes in', async () => {
    // Why: it's the worker who needs to act — accept or decline.
    const { listener, notifQueue } = buildListener();

    await listener.onBookingCreated({ workerId: 'worker-1', bookingId: 'b1' });

    expect(notifQueue.add).toHaveBeenCalledWith('send-notification', {
      userId: 'worker-1',
      type: 'BOOKING_REQUEST',
      bookingId: 'b1',
    });
  });

  it('notifies the CLIENT (not the worker) when their booking gets accepted', async () => {
    // Why: it's the client waiting to hear back this time.
    const { listener, notifQueue } = buildListener();

    await listener.onBookingAccepted({ clientId: 'client-1', bookingId: 'b1' });

    expect(notifQueue.add).toHaveBeenCalledWith('send-notification', {
      userId: 'client-1',
      type: 'BOOKING_ACCEPTED',
      bookingId: 'b1',
    });
  });

  it('notifies BOTH the client and the worker when a booking completes', async () => {
    // Why: both sides care that the job is done.
    const { listener, notifQueue } = buildListener();

    await listener.onBookingCompleted({ clientId: 'client-1', workerId: 'worker-1', bookingId: 'b1' });

    expect(notifQueue.addBulk).toHaveBeenCalledWith([
      expect.objectContaining({ data: expect.objectContaining({ userId: 'client-1' }) }),
      expect.objectContaining({ data: expect.objectContaining({ userId: 'worker-1' }) }),
    ]);
  });

  it('marks a safeguarding report as urgent when escalating to admins', async () => {
    // Why: admins should be able to instantly tell an urgent alert apart from routine ones.
    const { listener, notifQueue } = buildListener();

    await listener.onReportEscalated({ reportId: 'r1', category: 'safety_concern' });

    expect(notifQueue.add).toHaveBeenCalledWith(
      'alert-super-admin',
      expect.objectContaining({ urgent: true }),
    );
  });

  it('notifies BOTH sides when a dispute is resolved', async () => {
    const { listener, notifQueue } = buildListener();

    await listener.onDisputeResolved({
      bookingId: 'b1',
      clientId: 'client-1',
      workerId: 'worker-1',
      outcome: 'refunded',
    });

    expect(notifQueue.addBulk).toHaveBeenCalledWith([
      expect.objectContaining({ data: expect.objectContaining({ userId: 'client-1', type: 'DISPUTE_RESOLVED' }) }),
      expect.objectContaining({ data: expect.objectContaining({ userId: 'worker-1', type: 'DISPUTE_RESOLVED' }) }),
    ]);
  });
});
