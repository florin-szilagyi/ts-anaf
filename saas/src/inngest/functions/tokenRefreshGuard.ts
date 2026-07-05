import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { anafGrants } from '@/db/schema';
import { getGrantAccessToken } from '@/lib/anaf/grantTokens';
import { inngest } from '../client';

/**
 * Daily guard that keeps the token rotation chain alive:
 *  - refreshes grants whose access token expires within 7 days (rotating the
 *    refresh token in the process, so it never idles toward its 365-day death)
 *  - the dashboard surfaces reconnect banners from refreshTokenObtainedAt.
 */
export const tokenRefreshGuard = inngest.createFunction(
  { id: 'token-refresh-guard', retries: 1 },
  { cron: '30 2 * * *' }, // daily 02:30 UTC
  async ({ step }) => {
    const soonMs = 7 * 24 * 60 * 60 * 1000;

    const expiring = await step.run('select-expiring', async () => {
      const rows = await db
        .select({ id: anafGrants.id })
        .from(anafGrants)
        .where(
          and(eq(anafGrants.status, 'active'), lt(anafGrants.accessTokenExpiresAt, new Date(Date.now() + soonMs)))
        );
      return rows.map((r) => r.id);
    });

    let refreshed = 0;
    let failed = 0;
    for (const grantId of expiring) {
      await step.run(`refresh-${grantId}`, async () => {
        try {
          // minValidityMs of 8 days forces the refresh for anything selected above.
          await getGrantAccessToken(db, grantId, undefined, { minValidityMs: 8 * 24 * 60 * 60 * 1000 });
          refreshed += 1;
        } catch (cause) {
          // getGrantAccessToken already marked the grant expired + lastError.
          failed += 1;
          await db
            .update(anafGrants)
            .set({ lastError: cause instanceof Error ? cause.message : String(cause), updatedAt: sql`now()` })
            .where(eq(anafGrants.id, grantId));
        }
      });
    }
    return { candidates: expiring.length, refreshed, failed };
  }
);
