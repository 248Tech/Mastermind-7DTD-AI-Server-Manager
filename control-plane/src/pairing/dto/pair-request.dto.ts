import { IsString, IsObject, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** Host metadata sent by agent at pairing (and heartbeat). */
export class HostMetadataDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  cpu?: string;

  @IsOptional()
  memTotalMB?: number;

  @IsOptional()
  memFreeMB?: number;

  @IsOptional()
  @IsString()
  diskPath?: string;

  @IsOptional()
  diskFreeMB?: number;

  @IsOptional()
  @IsString()
  agentVersion?: string;
}

/**
 * Agent: request body for POST /api/agent/pair.
 * No auth; token is the credential.
 */
export class PairRequestDto {
  @IsOptional()
  @IsString()
  pairingToken?: string;

  /** Legacy snake_case alias accepted for backward compatibility. */
  @IsOptional()
  @IsString()
  pairing_token?: string;

  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => HostMetadataDto)
  hostMetadata?: HostMetadataDto;

  /** Legacy snake_case alias accepted for backward compatibility. */
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => HostMetadataDto)
  host_metadata?: HostMetadataDto;
}
