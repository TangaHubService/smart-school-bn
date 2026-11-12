import crypto from 'crypto';

import { env } from '../../config/env';

/**
 * Encrypts secrets stored in the database (e.g. a school's OpenAI key) with AES-256-GCM.
 * The key comes from SECRETS_ENCRYPTION_KEY, or is derived from JWT_ACCESS_SECRET when
 * that is not set. Changing either makes previously stored secrets unreadable.
 */
function encryptionKey() {
  const source = env.SECRETS_ENCRYPTION_KEY || `secret-box:${env.JWT_ACCESS_SECRET}`;
  return crypto.createHash('sha256').update(source).digest();
}

/** Returns "v1:<iv>:<tag>:<ciphertext>" (base64 parts). */
export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join(':');
}

export function decryptSecret(payload: string): string | null {
  try {
    const [version, iv, tag, data] = payload.split(':');
    if (version !== 'v1' || !iv || !tag || !data) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
