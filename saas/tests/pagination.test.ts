import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, parseLimit } from '@/lib/api/pagination';
import { ApiError } from '@/lib/errors';

describe('pagination', () => {
  it('round-trips cursors', () => {
    const c = { createdAt: new Date('2026-07-01T10:00:00.000Z'), id: 'abc-123' };
    const decoded = decodeCursor(encodeCursor(c));
    expect(decoded?.createdAt.toISOString()).toBe(c.createdAt.toISOString());
    expect(decoded?.id).toBe(c.id);
  });

  it('returns null for missing cursor and throws for junk', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(() => decodeCursor('!!!not-base64!!!')).toThrowError(ApiError);
  });

  it('parses limits with bounds', () => {
    expect(parseLimit(null)).toBe(25);
    expect(parseLimit('50')).toBe(50);
    expect(() => parseLimit('0')).toThrowError(ApiError);
    expect(() => parseLimit('101')).toThrowError(ApiError);
    expect(() => parseLimit('abc')).toThrowError(ApiError);
  });
});
