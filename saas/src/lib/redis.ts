import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { env } from './env';

/**
 * Upstash-backed sliding-window rate limiters. When Upstash env vars are
 * absent (local dev), falls back to an in-memory limiter — correct only for a
 * single process, which is exactly the dev server.
 */

type Limiter = {
  limit: (identifier: string) => Promise<{ success: boolean; limit: number; remaining: number; reset: number }>;
};

const globalForRedis = globalThis as unknown as {
  __fastbillLimiters?: { perKey: Limiter; perUser: Limiter; dashboard: Limiter };
};

function hasUpstash(): boolean {
  return Boolean(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN);
}

function makeUpstashLimiter(tokens: number, windowSec: number, prefix: string): Limiter {
  const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN });
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(tokens, `${windowSec} s`),
    prefix: `fastbill:rl:${prefix}`,
  });
}

/** Minimal in-memory sliding window for local dev / tests. */
export function makeMemoryLimiter(tokens: number, windowSec: number): Limiter {
  const hits = new Map<string, number[]>();
  return {
    async limit(identifier: string) {
      const now = Date.now();
      const windowMs = windowSec * 1000;
      const arr = (hits.get(identifier) ?? []).filter((t) => t > now - windowMs);
      const success = arr.length < tokens;
      if (success) arr.push(now);
      hits.set(identifier, arr);
      return { success, limit: tokens, remaining: Math.max(0, tokens - arr.length), reset: now + windowMs };
    },
  };
}

export interface RateLimiters {
  /** Per API key: 60 req/min. */
  perKey: Limiter;
  /** Per account across keys: 120 req/min. */
  perUser: Limiter;
  /** Dashboard mutations (server actions): 30 req/min per user. */
  dashboard: Limiter;
}

export function getRateLimiters(): RateLimiters {
  globalForRedis.__fastbillLimiters ??= hasUpstash()
    ? {
        perKey: makeUpstashLimiter(60, 60, 'key'),
        perUser: makeUpstashLimiter(120, 60, 'user'),
        dashboard: makeUpstashLimiter(30, 60, 'dash'),
      }
    : {
        perKey: makeMemoryLimiter(60, 60),
        perUser: makeMemoryLimiter(120, 60),
        dashboard: makeMemoryLimiter(30, 60),
      };
  return globalForRedis.__fastbillLimiters;
}
