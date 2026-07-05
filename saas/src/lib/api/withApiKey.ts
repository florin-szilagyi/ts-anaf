import { and, eq, isNull, sql } from 'drizzle-orm';
import type { NextRequest, NextResponse } from 'next/server';
import { db, type Db } from '@/db';
import { apiKeys, type ApiKeyMode } from '@/db/schema';
import { hashApiKey, parseKeyMode } from '../apiKeys';
import { ApiError } from '../errors';
import { getRateLimiters } from '../redis';
import { failFromUnknown } from './respond';

export interface ApiContext {
  db: Db;
  userId: string;
  keyId: string;
  mode: ApiKeyMode;
}

export type ApiHandler = (req: NextRequest, ctx: ApiContext, params: Record<string, string>) => Promise<NextResponse>;

/**
 * Public-API auth wrapper:
 *   Bearer sk_(test|live)_... → sha256 lookup → revocation check →
 *   per-key + per-user sliding-window rate limits → handler context.
 */
export function withApiKey(handler: ApiHandler) {
  // `route` is typed unknown so the same wrapper satisfies Next's generated
  // RouteContext types for both static and dynamic segments.
  return async (req: NextRequest, route?: unknown): Promise<NextResponse> => {
    try {
      const secret = bearerToken(req);
      if (!secret || !parseKeyMode(secret)) {
        throw new ApiError({
          code: 'UNAUTHORIZED',
          message: 'Provide an API key: Authorization: Bearer sk_test_... or sk_live_...',
        });
      }

      const [key] = await db
        .select()
        .from(apiKeys)
        .where(and(eq(apiKeys.keyHash, hashApiKey(secret)), isNull(apiKeys.revokedAt)))
        .limit(1);
      if (!key) {
        throw new ApiError({ code: 'UNAUTHORIZED', message: 'Unknown or revoked API key' });
      }

      const limiters = getRateLimiters();
      const [perKey, perUser] = await Promise.all([limiters.perKey.limit(key.id), limiters.perUser.limit(key.userId)]);
      const blocked = !perKey.success ? perKey : !perUser.success ? perUser : null;
      if (blocked) {
        throw new ApiError({
          code: 'RATE_LIMITED',
          message: 'Rate limit exceeded',
          headers: {
            'Retry-After': String(Math.max(1, Math.ceil((blocked.reset - Date.now()) / 1000))),
            'X-RateLimit-Limit': String(blocked.limit),
            'X-RateLimit-Remaining': String(blocked.remaining),
          },
        });
      }

      // Fire-and-forget last-used stamp (coarse — once per request is fine at this scale).
      void db
        .update(apiKeys)
        .set({ lastUsedAt: sql`now()` })
        .where(eq(apiKeys.id, key.id))
        .catch(() => {});

      const routeParams = (route as { params?: Promise<Record<string, string>> } | undefined)?.params;
      const params = routeParams ? await routeParams : {};
      return await handler(req, { db, userId: key.userId, keyId: key.id, mode: key.mode }, params);
    } catch (cause) {
      return failFromUnknown(cause);
    }
  };
}

function bearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}
