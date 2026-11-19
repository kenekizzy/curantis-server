import { IsString, MinLength, IsEnum } from 'class-validator';
import { Role } from '@prisma/client';

export class LoginDto {
  @IsString()
  identifier!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsEnum(Role)
  role!: Role;
}
