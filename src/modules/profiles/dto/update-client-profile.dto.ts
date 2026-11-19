import { PartialType } from '@nestjs/swagger';
import { CreateClientProfileDto } from './create-client-profile.dto.js';

export class UpdateClientProfileDto extends PartialType(CreateClientProfileDto) {}
