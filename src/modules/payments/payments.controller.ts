import { Controller, Post, Get, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../../common/types/jwt-payload.type.js';
import { PaymentsService } from './payments.service.js';
import { InitiatePaymentDto } from './dto/initiate-payment.dto.js';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Roles(Role.CLIENT)
  @Post('initiate')
  initiate(@Body() dto: InitiatePaymentDto, @CurrentUser() user: JwtPayload) {
    return this.paymentsService.initiate(dto.bookingId, user.sub);
  }

  @Get(':id')
  getPayment(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.paymentsService.getPayment(id, user.sub, user.role);
  }
}
