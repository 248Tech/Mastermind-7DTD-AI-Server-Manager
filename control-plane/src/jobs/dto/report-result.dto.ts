import { IsString, IsIn, IsOptional, IsNumber, Min } from 'class-validator';

export class ReportResultDto {
  @IsString()
  @IsIn(['success', 'failed'])
  status: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  durationMs?: number;

  @IsOptional()
  @IsString()
  errorMessage?: string;

  @IsOptional()
  @IsString()
  output?: string;
}
