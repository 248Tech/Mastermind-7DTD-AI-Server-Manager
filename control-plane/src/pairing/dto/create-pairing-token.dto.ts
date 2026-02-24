import { IsOptional, IsInt, Min, Max } from 'class-validator';

/**
 * Admin: create a pairing token for the current org.
 * Plaintext token is returned only once in the response.
 */
export class CreatePairingTokenDto {
  /** Token validity in seconds (default 900 = 15 min). Min 60, max 86400 (24h). */
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(86400)
  expiresInSec?: number = 900;
}
