import { IsString, IsNotEmpty, IsOptional, IsObject, IsIn } from 'class-validator';
import { JOB_TYPES } from '../constants';

export class CreateJobDto {
  @IsString()
  @IsIn([...JOB_TYPES])
  type: string;

  @IsString()
  @IsNotEmpty()
  serverInstanceId: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
