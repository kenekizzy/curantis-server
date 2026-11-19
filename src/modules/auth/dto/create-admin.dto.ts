import { IsEmail, IsEnum, IsOptional, IsPhoneNumber, IsString, Matches, MinLength } from 'class-validator';
import { AdminRole } from '@prisma/client';

export class CreateAdminDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsPhoneNumber('NG')
  phone?: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Password must contain an uppercase letter and a number',
  })
  password!: string;

  @IsEnum(AdminRole)
  role!: AdminRole;
}