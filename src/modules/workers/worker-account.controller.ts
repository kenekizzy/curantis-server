import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../../common/types/jwt-payload.type.js';
import { PaymentsService } from '../payments/payments.service.js';
import { AddBankAccountDto } from '../payments/dto/add-bank-account.dto.js';

@ApiTags('workers')
@ApiBearerAuth()
@Roles(Role.HW, Role.HS)
@Controller('workers')
export class WorkerAccountController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('me/earnings')
  getEarnings(@CurrentUser() user: JwtPayload) {
    return this.paymentsService.getEarnings(user.sub);
  }

  @Get('me/bank-accounts')
  listBankAccounts(@CurrentUser() user: JwtPayload) {
    return this.paymentsService.listBankAccounts(user.sub);
  }

  @Post('me/bank-accounts')
  addBankAccount(@Body() dto: AddBankAccountDto, @CurrentUser() user: JwtPayload) {
    return this.paymentsService.addBankAccount(user.sub, dto.bankCode, dto.accountNumber);
  }

  @Patch('me/bank-accounts/:id/default')
  setDefault(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.paymentsService.setDefaultAccount(user.sub, id);
  }

  @Delete('me/bank-accounts/:id')
  deleteAccount(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.paymentsService.deleteAccount(user.sub, id);
  }
}
