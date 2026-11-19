import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { CreateReportDto } from './dto/create-report.dto.js';

const SAFEGUARDING_CATEGORIES = ['safety_concern', 'misconduct'];

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(reporterId: string, dto: CreateReportDto) {
    if (dto.imageUrls && dto.imageUrls.length > 3) {
      throw new BadRequestException('Maximum of 3 images per report');
    }

    let verified = false;
    if (dto.bookingId) {
      const booking = await this.prisma.booking.findUnique({ where: { id: dto.bookingId } });
      verified =
        !!booking &&
        [booking.clientId, booking.workerId].includes(reporterId) &&
        [booking.clientId, booking.workerId].includes(dto.accusedId);
    }

    const report = await this.prisma.report.create({
      data: {
        reporterId,
        bookingId: dto.bookingId,
        accusedId: dto.accusedId,
        category: dto.category,
        description: dto.description,
        imageUrls: dto.imageUrls ?? [],
        status: 'OPEN',
      },
    });

    if (SAFEGUARDING_CATEGORIES.includes(dto.category)) {
      this.eventEmitter.emit('report.escalated', { reportId: report.id, category: dto.category });
    }

    if (!verified && dto.bookingId) {
      this.eventEmitter.emit('report.unverified', { reportId: report.id });
    }

    return { referenceNumber: report.id, status: 'OPEN' };
  }

  async listOwn(reporterId: string) {
    return this.prisma.report.findMany({
      where: { reporterId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(reportId: string, requesterId: string) {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Report not found');
    if (report.reporterId !== requesterId) throw new ForbiddenException();
    return report;
  }
}
