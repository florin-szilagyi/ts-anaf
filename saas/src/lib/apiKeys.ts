import { createHash, randomBytes } from 'node:crypto';
import type { ApiKeyMode } from '@/db/schema';

/**
 * API key format: sk_<mode>_<43 chars base64url> (256 bits of entropy).
 * Only the sha256 hash is persisted; the full secret is shown exactly once.
 */

const SECRET_BYTES = 32;

export interface GeneratedApiKey {
  /** Full secret — show once, never store. */
  secret: string;
  /** Display prefix, e.g. "sk_live_a1b2c3d4". */
  prefix: string;
  /** sha256 hex of the full secret — the stored form. */
  hash: string;
  mode: ApiKeyMode;
}

export function generateApiKey(mode: ApiKeyMode): GeneratedApiKey {
  const secret = `sk_${mode}_${randomBytes(SECRET_BYTES).toString('base64url')}`;
  return { secret, prefix: displayPrefix(secret), hash: hashApiKey(secret), mode };
}

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function displayPrefix(secret: string): string {
  // "sk_live_" + first 8 chars of the random part
  const m = secret.match(/^(sk_(?:test|live)_)(.{8})/);
  return m ? `${m[1]}${m[2]}` : secret.slice(0, 16);
}

export function parseKeyMode(secret: string): ApiKeyMode | null {
  if (secret.startsWith('sk_test_')) return 'test';
  if (secret.startsWith('sk_live_')) return 'live';
  return null;
}
