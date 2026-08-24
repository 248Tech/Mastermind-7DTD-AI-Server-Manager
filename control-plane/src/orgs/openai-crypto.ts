import { decryptIntegrationSecret, encryptIntegrationSecret } from './integration-crypto';

// Compatibility wrappers for existing callers and stored ciphertext.
export const encryptOpenAiKey = encryptIntegrationSecret;
export const decryptOpenAiKey = decryptIntegrationSecret;
