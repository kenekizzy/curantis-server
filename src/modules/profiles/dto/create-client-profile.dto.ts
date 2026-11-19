import { IsString, IsOptional, IsInt, Min } from 'class-validator';

export class CreateClientProfileDto {
  @IsString()
  fullName!: string;

  @IsString()
  state!: string;

  @IsString()
  lga!: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @IsOptional()
  @IsString()
  careRecipientName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  careRecipientAge?: number;

  @IsOptional()
  @IsString()
  careRecipientRel?: string;

  @IsOptional()
  @IsString()
  careNeedsSummary?: string;

  @IsOptional()
  @IsString()
  emergencyName?: string;

  @IsOptional()
  @IsString()
  emergencyPhone?: string;
}
