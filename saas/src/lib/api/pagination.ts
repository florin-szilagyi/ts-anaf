import { ApiError } from '../errors';

/**
 * Keyset cursor over (created_at desc, id desc). Encoded as base64url of
 * "<iso timestamp>|<uuid>" — opaque to clients.
 */
export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(`${c.createdAt.toISOString()}|${c.id}`).toString('base64url');
}

export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const [iso, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime()) || !id) throw new Error('bad cursor');
    return { createdAt, id };
  } catch {
    throw new ApiError({ code: 'INVALID_REQUEST', message: 'Invalid cursor parameter' });
  }
}

export function parseLimit(raw: string | null, { def = 25, max = 100 } = {}): number {
  if (!raw) return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > max) {
    throw new ApiError({ code: 'INVALID_REQUEST', message: `limit must be an integer between 1 and ${max}` });
  }
  return n;
}
