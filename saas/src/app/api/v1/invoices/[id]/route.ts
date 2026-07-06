import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { invoices } from '@/db/schema';
import { withApiKey, type ApiContext } from '@/lib/api/withApiKey';
import { ok } from '@/lib/api/respond';
import { env } from '@/lib/env';
import { ApiError } from '@/lib/errors';
import { invoiceToApi } from '@/lib/invoiceService';

export const GET = withApiKey(async (_req: NextRequest, ctx: ApiContext, params) => {
  const [row] = await ctx.db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, params.id), eq(invoices.userId, ctx.userId), eq(invoices.mode, ctx.mode)))
    .limit(1);
  if (!row) {
    throw new ApiError({ code: 'NOT_FOUND', message: 'Invoice not found' });
  }
  return ok(invoiceToApi(row, env.NEXT_PUBLIC_APP_URL));
});
