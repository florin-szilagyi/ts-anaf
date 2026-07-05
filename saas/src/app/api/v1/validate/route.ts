import { and, eq } from 'drizzle-orm';
import type { NextRequest } from 'next/server';
import { companies } from '@/db/schema';
import { withApiKey, type ApiContext } from '@/lib/api/withApiKey';
import { ok } from '@/lib/api/respond';
import { getToolsClient } from '@/lib/anaf/gateway';
import { buildUblFromInput } from '@/lib/anaf/partyMapping';
import { ApiError } from '@/lib/errors';
import { parseCreateInvoice } from '@/lib/validation/invoiceInput';

/**
 * Synchronous validate-only endpoint: builds the UBL XML from the same
 * payload as POST /invoices and runs ANAF's validator. No DB writes, no
 * quota — great for integration development.
 */
export const POST = withApiKey(async (req: NextRequest, ctx: ApiContext) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError({ code: 'INVALID_REQUEST', message: 'Request body must be JSON' });
  }
  const input = parseCreateInvoice(body);

  const [company] = await ctx.db
    .select()
    .from(companies)
    .where(and(eq(companies.id, input.companyId), eq(companies.userId, ctx.userId)))
    .limit(1);
  if (!company) throw new ApiError({ code: 'COMPANY_NOT_FOUND', message: 'Company not found for this account' });
  if (!company.grantId) throw new ApiError({ code: 'GRANT_MISSING', message: 'Connect ANAF first' });

  const { xml } = await buildUblFromInput(input, company.cif);
  const tools = await getToolsClient(ctx.db, { grantId: company.grantId });
  const result = await tools.validateXml(xml);

  return ok({
    valid: result.valid,
    details: result.details ?? null,
    info: result.info ?? null,
  });
});
