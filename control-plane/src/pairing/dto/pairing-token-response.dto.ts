/**
 * Admin: response when creating a pairing token.
 * Plaintext token is shown only once; store or pass to agent securely.
 */
export class PairingTokenResponseDto {
  id: string;
  token: string;
  expiresAt: Date;
  expiresInSec: number;
}
