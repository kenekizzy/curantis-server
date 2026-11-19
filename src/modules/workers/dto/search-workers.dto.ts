import { IsOptional, IsString, IsNumber, IsArray, IsEnum, IsIn, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { WorkerType } from '@prisma/client';

export class SearchWorkersDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  lga?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minRating?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minRateKobo?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxRateKobo?: number;

  @IsOptional()
  @IsEnum(WorkerType)
  workerType?: WorkerType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  languages?: string[];

  @IsOptional()
  @IsString()
  @IsIn(['rating', 'price_asc', 'price_desc', 'experience'])
  sort?: 'rating' | 'price_asc' | 'price_desc' | 'experience';

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number;
}
