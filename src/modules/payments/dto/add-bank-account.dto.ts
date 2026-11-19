import { IsString } from 'class-validator';

export class AddBankAccountDto {
  @IsString()
  bankCode!: string;

  @IsString()
  accountNumber!: string;
}
