import { IsString, MaxLength } from 'class-validator';

export class AllocsConsoleDto {
  @IsString()
  @MaxLength(200)
  command!: string;
}
