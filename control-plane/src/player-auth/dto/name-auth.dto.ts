import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class NameAuthDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  next?: string;
}
