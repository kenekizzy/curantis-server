import { IsString } from 'class-validator';

export class ResendOtpDto {
  @IsString()
  identifier!: string;
}
