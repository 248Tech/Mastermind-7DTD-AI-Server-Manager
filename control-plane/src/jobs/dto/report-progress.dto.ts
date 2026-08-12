import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReportProgressDto {
  @IsString()
  @IsIn(['queued', 'running'])
  phase: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
