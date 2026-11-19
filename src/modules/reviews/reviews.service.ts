import { Injectable, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { UpdateReviewDto } from './dto/update-review.dto.js';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(clientId: string, dto: CreateReviewDto) {
    const booking = await this.prisma.booking.findUnique({ where: { id: dto.bookingId } });
    if (!booking || booking.clientId !== clientId) throw new ForbiddenException();
    if (booking.status !== 'COMPLETED') {
      throw new BadRequestException('Reviews can only be left after a completed booking');
    }

    const existing = await this.prisma.review.findUnique({ where: { bookingId: dto.bookingId } });
    if (existing) throw new BadRequestException('You have already reviewed this booking');

    const review = await this.prisma.review.create({
      data: {
        bookingId: dto.bookingId,
        clientId,
        workerId: booking.workerId,
        rating: dto.rating,
        body: dto.body,
      },
    });

    await this.recalculateWorkerRating(booking.workerId);
    return review;
  }

  async update(reviewId: string, clientId: string, dto: UpdateReviewDto) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review || review.clientId !== clientId) throw new ForbiddenException();

    const editWindowExpired = Date.now() - review.createdAt.getTime() > 48 * 3_600_000;
    if (editWindowExpired) throw new BadRequestException('The 48-hour edit window has passed');

    const updated = await this.prisma.review.update({
      where: { id: reviewId },
      data: { rating: dto.rating, body: dto.body, editedAt: new Date() },
    });

    await this.recalculateWorkerRating(review.workerId);
    return updated;
  }

  async flag(reviewId: string) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('Review not found');

    return this.prisma.review.update({
      where: { id: reviewId },
      data: { status: 'FLAGGED' },
    });
  }

  private async recalculateWorkerRating(workerId: string) {
    const result = await this.prisma.review.aggregate({
      where: { workerId, status: 'PUBLISHED' },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await this.prisma.workerProfile.update({
      where: { userId: workerId },
      data: {
        avgRating: result._avg.rating ?? 0,
        reviewCount: result._count.rating,
      },
    });
  }
}
