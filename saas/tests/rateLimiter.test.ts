import { describe, expect, it } from 'vitest';
import { makeMemoryLimiter } from '@/lib/redis';

describe('memory rate limiter (dev fallback)', () => {
  it('enforces the window', async () => {
    const limiter = makeMemoryLimiter(3, 60);
    expect((await limiter.limit('k')).success).toBe(true);
    expect((await limiter.limit('k')).success).toBe(true);
    expect((await limiter.limit('k')).success).toBe(true);
    const fourth = await limiter.limit('k');
    expect(fourth.success).toBe(false);
    expect(fourth.remaining).toBe(0);
  });

  it('isolates identifiers', async () => {
    const limiter = makeMemoryLimiter(1, 60);
    expect((await limiter.limit('a')).success).toBe(true);
    expect((await limiter.limit('b')).success).toBe(true);
    expect((await limiter.limit('a')).success).toBe(false);
  });
});
