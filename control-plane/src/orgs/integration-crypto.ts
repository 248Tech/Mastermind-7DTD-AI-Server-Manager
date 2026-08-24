import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

function encryptionKey(): Buffer {
  // Keep the historical environment variable as the source so existing
  // OpenAI/Kimi ciphertext remains decryptable. It now protects all stored
  // integration credentials, including Cloudflare API tokens.
  return createHash('sha256')
    .update(process.env.OPENAI_KEY_ENCRYPTION_SECRET || process.env.JWT_SECRET || 'change-me-in-production')
    .digest();
}

export function encryptIntegrationSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptIntegrationSecret(value: string): string {
  const [version, iv, tag, data] = value.split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Stored integration credential is invalid');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
