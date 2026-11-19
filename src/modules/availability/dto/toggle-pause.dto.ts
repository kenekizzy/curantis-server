import { IsBoolean } from 'class-validator';

export class TogglePauseDto {
  @IsBoolean()
  isAvailable!: boolean;
}
