import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class NotificationsListener {
  constructor(@InjectQueue('notifications') private readonly notifQueue: Queue) {}

  @OnEvent('booking.created')
  async onBookingCreated(payload: { workerId: string; bookingId: string }): Promise<void> {
    await this.notifQueue.add('send-notification', {
      userId: payload.workerId,
      type: 'BOOKING_REQUEST',
      bookingId: payload.bookingId,
    });
  }

  @OnEvent('booking.accepted')
  async onBookingAccepted(payload: { clientId: string; bookingId: string }): Promise<void> {
    await this.notifQueue.add('send-notification', {
      userId: payload.clientId,
      type: 'BOOKING_ACCEPTED',
      bookingId: payload.bookingId,
    });
  }

  @OnEvent('booking.completed')
  async onBookingCompleted(payload: {
    clientId: string;
    workerId: string;
    bookingId: string;
  }): Promise<void> {
    await this.notifQueue.addBulk([
      {
        name: 'send-notification',
        data: { userId: payload.clientId, type: 'BOOKING_COMPLETE', bookingId: payload.bookingId },
      },
      {
        name: 'send-notification',
        data: { userId: payload.workerId, type: 'BOOKING_COMPLETE', bookingId: payload.bookingId },
      },
    ]);
  }

  @OnEvent('payment.successful')
  async onPaymentSuccessful(payload: { bookingId: string; paymentId: string }): Promise<void> {
    await this.notifQueue.add('send-notification', {
      type: 'PAYMENT_CONFIRMED',
      bookingId: payload.bookingId,
      metadata: { paymentId: payload.paymentId },
    });
  }

  @OnEvent('verification.status_changed')
  async onVerificationStatusChanged(payload: {
    userId: string;
    status: string;
  }): Promise<void> {
    await this.notifQueue.add('send-notification', {
      userId: payload.userId,
      type: 'VERIFICATION_UPDATE',
      metadata: { status: payload.status },
    });
  }

  @OnEvent('report.escalated')
  async onReportEscalated(payload: { reportId: string; category: string }): Promise<void> {
    await this.notifQueue.add('alert-super-admin', {
      reportId: payload.reportId,
      category: payload.category,
      urgent: true,
    });
  }

  @OnEvent('dispute.resolved')
  async onDisputeResolved(payload: {
    bookingId: string;
    clientId: string;
    workerId: string;
    outcome: string;
  }): Promise<void> {
    await this.notifQueue.addBulk([
      {
        name: 'send-notification',
        data: { userId: payload.clientId, type: 'DISPUTE_RESOLVED', bookingId: payload.bookingId },
      },
      {
        name: 'send-notification',
        data: { userId: payload.workerId, type: 'DISPUTE_RESOLVED', bookingId: payload.bookingId },
      },
    ]);
  }
}
