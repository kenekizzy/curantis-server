import { IsOptional, IsString } from 'class-validator';

export class AcceptBookingDto {
  @IsOptional()
  @IsString()
  message?: string;
}
