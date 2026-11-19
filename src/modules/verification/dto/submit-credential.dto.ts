import { IsString, IsOptional, IsDateString } from 'class-validator';

export class SubmitCredentialDto {
  @IsString()
  title!: string;

  @IsString()
  issuingBody!: string;

  @IsOptional()
  @IsString()
  licenceNumber?: string;

  @IsString()
  documentUrl!: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
