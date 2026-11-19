import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { WorkersService } from './workers.service.js';
import { SearchWorkersDto } from './dto/search-workers.dto.js';

@ApiTags('caregivers')
@ApiBearerAuth()
@Controller('caregivers')
export class WorkersController {
  constructor(private readonly workersService: WorkersService) {}

  @Public()
  @Get()
  search(@Query() dto: SearchWorkersDto) {
    return this.workersService.search(dto);
  }

  @Roles(Role.CLIENT)
  @Get(':id')
  getProfile(@Param('id') id: string) {
    return this.workersService.getPublicProfile(id);
  }

  @Roles(Role.CLIENT)
  @Get(':id/availability')
  getAvailability(
    @Param('id') id: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.workersService.getWorkerAvailability(id, startDate, endDate);
  }
}
