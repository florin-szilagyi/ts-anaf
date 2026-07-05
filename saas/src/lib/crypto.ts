import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from './env';

/**
 * AES-256-GCM encryption for ANAF tokens at rest.
 * Ciphertext format: `v1.<iv>.<ciphertext>.<authTag>` — all base64url.
 * The version prefix allows future key rotation (decrypt by version,
 * re-encrypt on next write).
 */

const VERSION = 'v1';
const IV_BYTES = 12;

function key(): Buffer {
  return Buffer.from(env.FASTBILL_ENCRYPTION_KEY, 'base64');
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, b64url(iv), b64url(ct), b64url(tag)].join('.');
}

export function decryptSecret(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error(`unsupported ciphertext format (expected "${VERSION}.iv.ct.tag")`);
  }
  const [, ivB64, ctB64, tagB64] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key(), fromB64url(ivB64));
  decipher.setAuthTag(fromB64url(tagB64));
  return Buffer.concat([decipher.update(fromB64url(ctB64)), decipher.final()]).toString('utf8');
}

/** HMAC-SHA256 signing for OAuth state params (key derived from the encryption key). */
export function signPayload(payload: string): string {
  const mac = createHmac('sha256', key()).update(`state:${payload}`).digest();
  return b64url(mac);
}

export function verifySignature(payload: string, signature: string): boolean {
  const expected = signPayload(payload);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}
