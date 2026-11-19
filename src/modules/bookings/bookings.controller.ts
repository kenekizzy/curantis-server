import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../../common/types/jwt-payload.type.js';
import { BookingsService } from './bookings.service.js';
import { CreateBookingDto } from './dto/create-booking.dto.js';
import { ListBookingsDto } from './dto/list-bookings.dto.js';
import { AcceptBookingDto } from './dto/accept-booking.dto.js';
import { DeclineBookingDto } from './dto/decline-booking.dto.js';
import { CancelBookingDto } from './dto/cancel-booking.dto.js';
import { DisputeBookingDto } from './dto/dispute-booking.dto.js';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Roles(Role.CLIENT)
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateBookingDto) {
    return this.bookingsService.create(user.sub, dto);
  }

  @Get()
  list(@CurrentUser() user: JwtPayload, @Query() dto: ListBookingsDto) {
    return this.bookingsService.list(user.sub, user.role, dto);
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.bookingsService.findOne(id, user.sub, user.role);
  }

  @Roles(Role.HW, Role.HS)
  @Patch(':id/accept')
  accept(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AcceptBookingDto,
  ) {
    return this.bookingsService.accept(id, user.sub, dto.message);
  }

  @Roles(Role.HW, Role.HS)
  @Patch(':id/decline')
  decline(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: DeclineBookingDto,
  ) {
    return this.bookingsService.decline(id, user.sub, dto.reason);
  }

  @Patch(':id/cancel')
  cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
  ) {
    return this.bookingsService.cancel(id, user.sub, user.role, dto.reason);
  }

  @Roles(Role.HW, Role.HS)
  @Patch(':id/start')
  start(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.bookingsService.start(id, user.sub);
  }

  @Roles(Role.HW, Role.HS)
  @Patch(':id/complete')
  complete(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.bookingsService.complete(id, user.sub);
  }

  @Post(':id/dispute')
  raiseDispute(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: DisputeBookingDto,
  ) {
    return this.bookingsService.raiseDispute(id, user.sub, dto.description);
  }

  @Get(':id/logs')
  getLogs(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.bookingsService.getLogs(id, user.sub, user.role);
  }
}
