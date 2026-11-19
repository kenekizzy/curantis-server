import { IsString } from 'class-validator';

export class DisputeBookingDto {
  @IsString()
  description!: string;
}
