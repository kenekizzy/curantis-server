import { IsEmail, IsEnum, IsOptional, IsPhoneNumber, IsString, Matches, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class RegisterDto {
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

  @IsEnum(Role)
  role!: Role;
}
