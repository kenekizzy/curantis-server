import { IsString, IsOptional, IsArray, MaxLength, IsIn } from 'class-validator';

const REPORT_CATEGORIES = [
  'safety_concern',
  'misconduct',
  'no_show',
  'quality_issue',
  'fraud',
  'other',
] as const;

export class CreateReportDto {
  @IsOptional()
  @IsString()
  bookingId?: string;

  @IsString()
  accusedId!: string;

  @IsIn(REPORT_CATEGORIES)
  category!: string;

  @IsString()
  @MaxLength(1000)
  description!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];
}
