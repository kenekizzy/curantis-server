import { IsString, MinLength, Matches, IsOptional } from 'class-validator';

export class RequestPasswordResetDto {
  @IsOptional()
  @IsString()
  identifier?: string;

  @IsOptional()
  @IsString()
  email?: string;
}

export class ResetPasswordDto {
  @IsOptional()
  @IsString()
  token?: string;

  @IsOptional()
  @IsString()
  identifier?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Password must contain an uppercase letter and a number',
  })
  newPassword!: string;
}
