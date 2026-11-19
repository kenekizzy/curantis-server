import { IsString } from 'class-validator';

export class InitiatePaymentDto {
  @IsString()
  bookingId!: string;
}
