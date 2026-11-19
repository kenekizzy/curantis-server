import { IsString, IsDateString, IsNumber, Min, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBookingDto {
  @IsString()
  workerId!: string;

  @IsString()
  categoryId!: string;

  @IsDateString()
  scheduledStart!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  durationHours!: number;

  @IsString()
  careAddress!: string;

  @IsOptional()
  @IsString()
  careRequirements?: string;
}
