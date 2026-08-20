import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class FrigateEventObjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  camera?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  label?: string;

  @IsOptional()
  @IsNumber()
  score?: number;

  @IsOptional()
  @IsNumber()
  top_score?: number;

  @IsOptional()
  @IsBoolean()
  false_positive?: boolean;
}

export class FrigateWebhookDto {
  @IsIn(['new', 'update', 'end'])
  type!: 'new' | 'update' | 'end';

  @IsOptional()
  @ValidateNested()
  @Type(() => FrigateEventObjectDto)
  before?: FrigateEventObjectDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => FrigateEventObjectDto)
  after?: FrigateEventObjectDto;
}
