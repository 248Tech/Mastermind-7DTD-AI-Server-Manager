import { IsString, IsArray, IsOptional, IsObject, IsIn, ArrayMinSize } from 'class-validator';

export const BATCH_TYPES = ['restart_wave', 'update_wave', 'bulk_mod_install', 'custom'] as const;
export type BatchType = (typeof BATCH_TYPES)[number];

export class CreateBatchDto {
  @IsString()
  @IsIn([...BATCH_TYPES])
  type: BatchType;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  serverInstanceIds: string[];

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
