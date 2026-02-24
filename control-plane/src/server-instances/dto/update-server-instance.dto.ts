import { IsOptional, IsString, MaxLength, Min, Max, IsInt, Matches, MinLength } from 'class-validator';

export class UpdateServerInstanceDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsString()
  hostId?: string;

  @IsOptional()
  @IsString()
  @Matches(/^(7dtd|minecraft)$/i, { message: 'gameType must be 7dtd or minecraft' })
  gameType?: string;

  @IsOptional()
  @IsString()
  installPath?: string;

  @IsOptional()
  @IsString()
  startCommand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^[\w.-]+$/, { message: 'telnetHost must be hostname or IP' })
  telnetHost?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  telnetPort?: number;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  telnetPassword?: string;
}
