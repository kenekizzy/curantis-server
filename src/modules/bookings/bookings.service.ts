import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BookingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { CreateBookingDto } from './dto/create-booking.dto.js';
import { ListBookingsDto } from './dto/list-bookings.dto.js';

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue('bookings') private readonly bookingsQueue: Queue,
  ) {}

  // ── Create ───────────────────────────────────────────────────

  async create(clientId: string, dto: CreateBookingDto) {
    const worker = await this.prisma.workerProfile.findUnique({
      where: { userId: dto.workerId },
    });
    if (!worker || worker.verificationStatus !== 'VERIFIED' || !worker.isAvailable) {
      throw new BadRequestException('This caregiver is not currently available for booking');
    }

    const category = await this.prisma.serviceCategory.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category) throw new BadRequestException('Invalid service category');

    if (category.isRestricted && worker.workerType === 'HS') {
      throw new ForbiddenException(
        'This service category requires a licensed Healthcare Worker',
      );
    }

    const scheduledStart = new Date(dto.scheduledStart);
    const scheduledEnd = new Date(scheduledStart.getTime() + dto.durationHours * 3_600_000);

    const booking = await this.prisma.$transaction(async (tx) => {
      const conflict = await tx.booking.findFirst({
        where: {
          workerId: dto.workerId,
          status: { in: [BookingStatus.PENDING, BookingStatus.ACCEPTED, BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS] },
          scheduledStart: { lt: scheduledEnd },
          scheduledEnd: { gt: scheduledStart },
        },
      });
      if (conflict) throw new BadRequestException('This time slot is no longer available');

      const totalAmountKobo = BigInt(Math.round(Number(worker.hourlyRateKobo) * dto.durationHours));
      const platformFeeKobo = totalAmountKobo / 10n;
      const workerAmountKobo = totalAmountKobo - platformFeeKobo;

      return tx.booking.create({
        data: {
          clientId,
          workerId: dto.workerId,
          categoryId: dto.categoryId,
          careAddress: dto.careAddress,
          careRequirements: dto.careRequirements,
          scheduledStart,
          scheduledEnd,
          durationHours: dto.durationHours,
          hourlyRateKobo: worker.hourlyRateKobo,
          totalAmountKobo,
          platformFeeKobo,
          workerAmountKobo,
          status: BookingStatus.PENDING,
        },
      });
    });

    await this.logEvent(booking.id, 'CREATED', clientId);

    await this.bookingsQueue.add(
      'auto-decline',
      { bookingId: booking.id },
      { delay: 2 * 3_600_000, jobId: `auto-decline-${booking.id}` },
    );

    this.eventEmitter.emit('booking.created', {
      bookingId: booking.id,
      workerId: dto.workerId,
      clientId,
    });

    return booking;
  }

  // ── Accept / Decline ─────────────────────────────────────────

  async accept(bookingId: string, workerId: string, message?: string) {
    const booking = await this.getOwnedBooking(bookingId, workerId, 'worker');
    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException('Booking is no longer pending');
    }

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.ACCEPTED },
    });
    await this.cancelAutoDeclineJob(bookingId);
    await this.logEvent(bookingId, 'ACCEPTED', workerId, message ? { message } : undefined);

    this.eventEmitter.emit('booking.accepted', { bookingId, clientId: booking.clientId });
    return { status: BookingStatus.ACCEPTED };
  }

  async decline(bookingId: string, workerId: string, reason?: string) {
    const booking = await this.getOwnedBooking(bookingId, workerId, 'worker');
    if (booking.status !== BookingStatus.PENDING) {
      throw new BadRequestException('Booking is no longer pending');
    }

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CANCELLED, cancelledBy: workerId, cancellationReason: reason },
    });
    await this.cancelAutoDeclineJob(bookingId);
    await this.logEvent(bookingId, 'DECLINED', workerId, reason ? { reason } : undefined);

    this.eventEmitter.emit('booking.declined', { bookingId, clientId: booking.clientId });
    return { status: BookingStatus.CANCELLED };
  }

  // ── Cancel ───────────────────────────────────────────────────

  async cancel(bookingId: string, actorId: string, actorRole: string, reason: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');

    if (actorRole !== 'ADMIN' && booking.clientId !== actorId && booking.workerId !== actorId) {
      throw new ForbiddenException();
    }
    if (booking.status === BookingStatus.COMPLETED || booking.status === BookingStatus.CANCELLED) {
      throw new BadRequestException('This booking cannot be cancelled');
    }

    const cancelledBy = actorRole === 'ADMIN' ? 'ADMIN' : actorId;

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CANCELLED, cancelledBy, cancellationReason: reason },
    });
    await this.cancelAutoDeclineJob(bookingId);
    await this.logEvent(bookingId, 'CANCELLED', actorId, { reason, actorRole });

    this.eventEmitter.emit('booking.cancelled', {
      bookingId,
      clientId: booking.clientId,
      workerId: booking.workerId,
      cancelledBy: actorRole,
    });

    return { status: BookingStatus.CANCELLED };
  }

  // ── Start / Complete ─────────────────────────────────────────

  async start(bookingId: string, workerId: string) {
    const booking = await this.getOwnedBooking(bookingId, workerId, 'worker');
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException('Booking must be confirmed before starting');
    }

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.IN_PROGRESS, actualStart: new Date() },
    });
    await this.logEvent(bookingId, 'STARTED', workerId);

    this.eventEmitter.emit('booking.started', { bookingId, clientId: booking.clientId });
    return { status: BookingStatus.IN_PROGRESS };
  }

  async complete(bookingId: string, workerId: string) {
    const booking = await this.getOwnedBooking(bookingId, workerId, 'worker');
    if (booking.status !== BookingStatus.IN_PROGRESS) {
      throw new BadRequestException('Booking must be in progress to complete');
    }

    const escrowReleaseAt = new Date(Date.now() + 24 * 3_600_000);

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.COMPLETED, actualEnd: new Date(), escrowReleaseAt },
    });
    await this.logEvent(bookingId, 'COMPLETED', workerId);

    this.eventEmitter.emit('booking.completed', {
      bookingId,
      workerId,
      clientId: booking.clientId,
      workerAmountKobo: booking.workerAmountKobo,
    });

    return { status: BookingStatus.COMPLETED };
  }

  // ── Dispute ──────────────────────────────────────────────────

  async raiseDispute(bookingId: string, actorId: string, description: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.clientId !== actorId && booking.workerId !== actorId) {
      throw new ForbiddenException();
    }

    await this.prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.DISPUTED },
    });
    await this.logEvent(bookingId, 'DISPUTE_RAISED', actorId, { description });

    // PaymentsModule listens to this event and cancels any pending payout job
    this.eventEmitter.emit('booking.disputed', {
      bookingId,
      clientId: booking.clientId,
      workerId: booking.workerId,
      raisedBy: actorId,
    });

    return { status: BookingStatus.DISPUTED };
  }

  // ── List / Find ──────────────────────────────────────────────

  async list(userId: string, role: string, dto: ListBookingsDto) {
    const limit = dto.limit ?? 20;
    const where: Prisma.BookingWhereInput = {};

    if (role === 'CLIENT') where.clientId = userId;
    else if (role === 'HW' || role === 'HS') where.workerId = userId;
    // ADMIN: no filter — sees all

    if (dto.status) where.status = dto.status;

    const bookings = await this.prisma.booking.findMany({
      where,
      orderBy: { scheduledStart: 'desc' },
      take: limit,
      ...(dto.cursor && { cursor: { id: dto.cursor }, skip: 1 }),
      include: { category: true },
    });

    return {
      items: bookings,
      meta: { nextCursor: bookings.at(-1)?.id ?? null, hasMore: bookings.length === limit },
    };
  }

  async findOne(bookingId: string, userId: string, role: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { category: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    if (role !== 'ADMIN' && booking.clientId !== userId && booking.workerId !== userId) {
      throw new ForbiddenException();
    }

    return booking;
  }

  async getLogs(bookingId: string, userId: string, role: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { clientId: true, workerId: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    if (role !== 'ADMIN' && booking.clientId !== userId && booking.workerId !== userId) {
      throw new ForbiddenException();
    }

    return this.prisma.bookingLog.findMany({
      where: { bookingId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── Helpers ──────────────────────────────────────────────────

  async logEvent(
    bookingId: string,
    eventType: string,
    actorId?: string,
    metadata?: Prisma.InputJsonValue,
  ) {
    return this.prisma.bookingLog.create({
      data: { bookingId, eventType, actorId, metadata },
    });
  }

  private async getOwnedBooking(bookingId: string, userId: string, role: 'client' | 'worker') {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) throw new NotFoundException('Booking not found');
    if (role === 'worker' && booking.workerId !== userId) throw new ForbiddenException();
    if (role === 'client' && booking.clientId !== userId) throw new ForbiddenException();
    return booking;
  }

  private async cancelAutoDeclineJob(bookingId: string) {
    const job = await this.bookingsQueue.getJob(`auto-decline-${bookingId}`);
    if (job) await job.remove();
  }
}
