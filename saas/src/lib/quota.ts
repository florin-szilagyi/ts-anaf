import { sql } from 'drizzle-orm';
import type { Db } from '@/db';
import type { ApiKeyMode } from '@/db/schema';
import { ApiError } from './errors';

/**
 * Daily invoice quota — live mode only, "10/day by default" stored per user
 * (users.daily_invoice_limit). Enforcement is a single atomic upsert so
 * concurrent requests can never exceed the limit:
 *
 *   INSERT ... ON CONFLICT DO UPDATE SET invoices_created = +1
 *   WHERE usage_counters.invoices_created < users.daily_invoice_limit
 *   RETURNING ...
 *
 * No row returned ⇒ the counter was already at the limit ⇒ QUOTA_EXCEEDED.
 */
export async function consumeDailyQuota(
  db: Db,
  userId: string,
  mode: ApiKeyMode
): Promise<{ used: number; limit: number }> {
  const limitRows = await db.execute(sql`select daily_invoice_limit as "limit" from users where id = ${userId}`);
  const limit = Number((limitRows as unknown as Array<{ limit: number }>)[0]?.limit ?? 10);

  if (mode === 'test') {
    // Test mode never counts toward the live quota (ANAF test env is for integration work).
    return { used: 0, limit };
  }

  const rows = await db.execute(sql`
    insert into usage_counters (user_id, day, mode, invoices_created)
    values (${userId}, current_date, ${mode}, 1)
    on conflict (user_id, day, mode)
    do update set invoices_created = usage_counters.invoices_created + 1
      where usage_counters.invoices_created < ${limit}
    returning invoices_created as "used"
  `);
  const row = (rows as unknown as Array<{ used: number }>)[0];
  if (!row) {
    throw new ApiError({
      code: 'QUOTA_EXCEEDED',
      message: `Daily live invoice quota reached (${limit}/day). Resets at midnight UTC.`,
      details: { limit },
      headers: { 'Retry-After': String(secondsUntilUtcMidnight()) },
    });
  }
  return { used: Number(row.used), limit };
}

/** Read-only view for the dashboard. */
export async function getQuotaUsage(db: Db, userId: string): Promise<{ used: number; limit: number }> {
  const rows = await db.execute(sql`
    select
      coalesce((select invoices_created from usage_counters
        where user_id = ${userId} and day = current_date and mode = 'live'), 0) as "used",
      (select daily_invoice_limit from users where id = ${userId}) as "limit"
  `);
  const row = (rows as unknown as Array<{ used: number; limit: number | null }>)[0];
  return { used: Number(row?.used ?? 0), limit: Number(row?.limit ?? 10) };
}

function secondsUntilUtcMidnight(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.floor((next - now.getTime()) / 1000));
}
