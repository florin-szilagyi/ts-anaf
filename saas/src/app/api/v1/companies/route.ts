import { eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { companies } from '@/db/schema';
import { withApiKey, type ApiContext } from '@/lib/api/withApiKey';
import { ok } from '@/lib/api/respond';

export const GET = withApiKey(async (_req: NextRequest, ctx: ApiContext) => {
  const rows = await ctx.db.select().from(companies).where(eq(companies.userId, ctx.userId));
  return ok({
    companies: rows.map((c) => ({
      id: c.id,
      cif: c.cif,
      name: c.name,
      vatPayer: c.vatPayer,
      spvVerified: Boolean(c.spvVerifiedAt),
      archiveEnabled: c.archiveEnabled,
      lastSyncAt: c.lastSyncAt,
    })),
  });
});
