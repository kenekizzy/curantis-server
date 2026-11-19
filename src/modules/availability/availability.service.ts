import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BookingStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { SlotDto } from './dto/set-schedule.dto.js';

@Injectable()
export class AvailabilityService {
  constructor(private readonly prisma: PrismaService) {}

  async getSchedule(userId: string) {
    const profile = await this.prisma.workerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) return { slots: [], blocks: [] };

    const [slots, blocks] = await Promise.all([
      this.prisma.availabilitySlot.findMany({
        where: { workerId: profile.id },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      }),
      this.prisma.availabilityBlock.findMany({
        where: { workerId: profile.id, endDate: { gte: new Date() } },
        orderBy: { startDate: 'asc' },
      }),
    ]);

    return { slots, blocks };
  }

  async setWeeklySchedule(userId: string, slots: SlotDto[]) {
    const profile = await this.prisma.workerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Worker profile not found');

    const upcomingBookings = await this.prisma.booking.findMany({
      where: {
        workerId: userId,
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS] },
        scheduledStart: { gte: new Date() },
      },
      select: { id: true },
    });
    if (upcomingBookings.length > 0) {
      throw new BadRequestException(
        'Cannot modify schedule while you have upcoming confirmed bookings',
      );
    }

    await this.prisma.availabilitySlot.deleteMany({ where: { workerId: profile.id } });

    if (slots.length > 0) {
      await this.prisma.availabilitySlot.createMany({
        data: slots.map((s) => ({
          workerId: profile.id,
          dayOfWeek: s.dayOfWeek,
          startTime: s.startTime,
          endTime: s.endTime,
        })),
      });
    }

    return this.prisma.availabilitySlot.findMany({
      where: { workerId: profile.id },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
  }

  async addBlock(userId: string, startDate: Date, endDate: Date, reason?: string) {
    const profile = await this.prisma.workerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Worker profile not found');

    if (endDate < startDate) {
      throw new BadRequestException('endDate must be on or after startDate');
    }

    const conflict = await this.prisma.booking.findFirst({
      where: {
        workerId: userId,
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.IN_PROGRESS] },
        scheduledStart: { lt: endDate },
        scheduledEnd: { gt: startDate },
      },
    });
    if (conflict) {
      throw new BadRequestException('A confirmed booking exists within this date range');
    }

    return this.prisma.availabilityBlock.create({
      data: { workerId: profile.id, startDate, endDate, reason },
    });
  }

  async deleteBlock(userId: string, blockId: string) {
    const profile = await this.prisma.workerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!profile) throw new NotFoundException('Worker profile not found');

    const block = await this.prisma.availabilityBlock.findUnique({
      where: { id: blockId },
    });
    if (!block || block.workerId !== profile.id) {
      throw new ForbiddenException('Cannot delete this availability block');
    }

    return this.prisma.availabilityBlock.delete({ where: { id: blockId } });
  }

  async togglePause(userId: string, isAvailable: boolean) {
    return this.prisma.workerProfile.update({
      where: { userId },
      data: { isAvailable },
      select: { userId: true, isAvailable: true, updatedAt: true },
    });
  }
}
