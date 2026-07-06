import { and, desc, eq, gte, lt, lte, or, type SQL } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { invoices, companies, invoiceDirections, invoiceStatuses } from '@/db/schema';
import { withApiKey, type ApiContext } from '@/lib/api/withApiKey';
import { decodeCursor, encodeCursor, parseLimit } from '@/lib/api/pagination';
import { ok } from '@/lib/api/respond';
import { env } from '@/lib/env';
import { ApiError } from '@/lib/errors';
import { createInvoice, invoiceToApi } from '@/lib/invoiceService';
import { parseCreateInvoice } from '@/lib/validation/invoiceInput';

export const POST = withApiKey(async (req: NextRequest, ctx: ApiContext) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError({ code: 'INVALID_REQUEST', message: 'Request body must be JSON' });
  }
  const input = parseCreateInvoice(body);
  const idempotencyKey = req.headers.get('idempotency-key') ?? undefined;

  const result = await createInvoice(ctx.db, {
    userId: ctx.userId,
    mode: ctx.mode,
    input,
    idempotencyKey,
  });

  return ok(
    {
      id: result.id,
      status: result.status,
      links: { self: `${env.NEXT_PUBLIC_APP_URL}/api/v1/invoices/${result.id}` },
    },
    { status: result.replayed ? 200 : 202 }
  );
});

export const GET = withApiKey(async (req: NextRequest, ctx: ApiContext) => {
  const q = req.nextUrl.searchParams;
  const limit = parseLimit(q.get('limit'));
  const cursor = decodeCursor(q.get('cursor'));

  const filters: SQL[] = [eq(invoices.userId, ctx.userId), eq(invoices.mode, ctx.mode)];

  const direction = q.get('direction');
  if (direction) {
    if (!(invoiceDirections as readonly string[]).includes(direction)) {
      throw new ApiError({
        code: 'INVALID_REQUEST',
        message: `direction must be one of ${invoiceDirections.join(', ')}`,
      });
    }
    filters.push(eq(invoices.direction, direction as (typeof invoiceDirections)[number]));
  }
  const status = q.get('status');
  if (status) {
    if (!(invoiceStatuses as readonly string[]).includes(status)) {
      throw new ApiError({ code: 'INVALID_REQUEST', message: `status must be one of ${invoiceStatuses.join(', ')}` });
    }
    filters.push(eq(invoices.status, status as (typeof invoiceStatuses)[number]));
  }
  const companyId = q.get('company_id');
  if (companyId) filters.push(eq(invoices.companyId, companyId));
  const counterpartyCif = q.get('counterparty_cif');
  if (counterpartyCif) filters.push(eq(invoices.counterpartyCif, counterpartyCif.replace(/^RO/i, '')));
  const from = q.get('from');
  if (from) filters.push(gte(invoices.issueDate, from));
  const to = q.get('to');
  if (to) filters.push(lte(invoices.issueDate, to));

  if (cursor) {
    const keyset = or(
      lt(invoices.createdAt, cursor.createdAt),
      and(eq(invoices.createdAt, cursor.createdAt), lt(invoices.id, cursor.id))
    );
    if (keyset) filters.push(keyset);
  }

  const rows = await ctx.db
    .select()
    .from(invoices)
    .innerJoin(companies, eq(invoices.companyId, companies.id))
    .where(and(...filters))
    .orderBy(desc(invoices.createdAt), desc(invoices.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const nextCursor =
    rows.length > limit
      ? encodeCursor({ createdAt: page[page.length - 1].invoices.createdAt, id: page[page.length - 1].invoices.id })
      : null;

  return ok({
    invoices: page.map((r) => ({ ...invoiceToApi(r.invoices, env.NEXT_PUBLIC_APP_URL), companyCif: r.companies.cif })),
    nextCursor,
  });
});
