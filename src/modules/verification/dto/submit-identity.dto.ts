import { IsString, IsOptional, Length } from 'class-validator';

export class SubmitIdentityDto {
  @IsOptional()
  @IsString()
  @Length(11, 11, { message: 'NIN must be exactly 11 digits' })
  nin?: string;

  @IsString()
  idDocUrl!: string;

  @IsString()
  selfieUrl!: string;
}
