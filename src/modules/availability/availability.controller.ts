import { Controller, Get, Put, Post, Delete, Patch, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { JwtPayload } from '../../common/types/jwt-payload.type.js';
import { AvailabilityService } from './availability.service.js';
import { SetScheduleDto } from './dto/set-schedule.dto.js';
import { AddBlockDto } from './dto/add-block.dto.js';
import { TogglePauseDto } from './dto/toggle-pause.dto.js';

@ApiTags('availability')
@ApiBearerAuth()
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Roles(Role.HW, Role.HS)
  @Get()
  getSchedule(@CurrentUser() user: JwtPayload) {
    return this.availabilityService.getSchedule(user.sub);
  }

  @Roles(Role.HW, Role.HS)
  @Put()
  setWeeklySchedule(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetScheduleDto,
  ) {
    return this.availabilityService.setWeeklySchedule(user.sub, dto.slots);
  }

  @Roles(Role.HW, Role.HS)
  @Post('blocks')
  addBlock(@CurrentUser() user: JwtPayload, @Body() dto: AddBlockDto) {
    return this.availabilityService.addBlock(
      user.sub,
      new Date(dto.startDate),
      new Date(dto.endDate),
      dto.reason,
    );
  }

  @Roles(Role.HW, Role.HS)
  @Delete('blocks/:id')
  deleteBlock(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.availabilityService.deleteBlock(user.sub, id);
  }

  @Roles(Role.HW, Role.HS)
  @Patch('pause')
  togglePause(
    @CurrentUser() user: JwtPayload,
    @Body() dto: TogglePauseDto,
  ) {
    return this.availabilityService.togglePause(user.sub, dto.isAvailable);
  }
}