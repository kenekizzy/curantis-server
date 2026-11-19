import {
  IsString,
  IsNumber,
  IsInt,
  Min,
  IsOptional,
  IsArray,
  IsEnum,
  ValidateIf,
} from 'class-validator';
import { WorkerType } from '@prisma/client';

export class CreateWorkerProfileDto {
  @IsString()
  fullName!: string;

  @IsOptional()
  @IsString()
  bio?: string;

  @IsEnum(WorkerType)
  workerType!: WorkerType;

  @IsNumber()
  @Min(500)
  hourlyRate!: number; // ₦ — converted to kobo in service

  @IsString()
  state!: string;

  @IsString()
  lga!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  yearsExperience?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  skills?: string[];

  // Student-only fields — required when workerType === HS
  @ValidateIf((o: CreateWorkerProfileDto) => o.workerType === WorkerType.HS)
  @IsString()
  institution?: string;

  @ValidateIf((o: CreateWorkerProfileDto) => o.workerType === WorkerType.HS)
  @IsInt()
  gradYear?: number;

  @ValidateIf((o: CreateWorkerProfileDto) => o.workerType === WorkerType.HS)
  @IsString()
  fieldOfStudy?: string;
}
