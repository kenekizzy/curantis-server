import { IsString, IsInt, Min } from 'class-validator';

export class AvatarUploadDto {
  @IsString()
  mimeType!: string;

  @IsInt()
  @Min(1)
  fileSize!: number;
}
