import { PartialType } from '@nestjs/swagger';
import { CreateWorkerProfileDto } from './create-worker-profile.dto.js';

export class UpdateWorkerProfileDto extends PartialType(CreateWorkerProfileDto) {}
