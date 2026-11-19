import { IsEmail, IsString, Matches, MinLength } from 'class-validator';


export class UpdateAdminPasswordDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Password must contain an uppercase letter and a number',
  })
  oldPassword!: string;

  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[A-Z])(?=.*\d).+$/, {
    message: 'Password must contain an uppercase letter and a number',
  })
  newPassword!: string;

}