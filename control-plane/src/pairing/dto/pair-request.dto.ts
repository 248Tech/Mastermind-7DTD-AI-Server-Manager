import { IsString, IsNotEmpty, IsObject, IsOptional, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** Host metadata sent by agent at pairing (and heartbeat). */
export class HostMetadataDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  cpu?: string;

  @IsOptional()
  memTotalMB?: number;

  @IsOptional()
  memFreeMB?: number;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  diskPath?: string;

  @IsOptional()
  diskFreeMB?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  agentVersion?: string;
}

/**
 * Agent: request body for POST /api/agent/pair.
 * No auth; token is the credential.
 */
export class PairRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  pairingToken: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => HostMetadataDto)
  hostMetadata?: HostMetadataDto;
}
