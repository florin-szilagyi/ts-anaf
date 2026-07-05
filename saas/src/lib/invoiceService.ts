import { and, eq } from 'drizzle-orm';
import type { Db } from '@/db';
import { companies, invoices, type ApiKeyMode } from '@/db/schema';
import { inngest } from '@/inngest/client';
import { computeTotals, normalizeCui } from './anaf/partyMapping';
import { ApiError } from './errors';
import { consumeDailyQuota } from './quota';
import type { CreateInvoiceInput } from './validation/invoiceInput';

/**
 * Shared invoice-creation path — used verbatim by POST /api/v1/invoices and
 * the dashboard's server action so UI and API behavior cannot drift.
 * Async contract: inserts a `queued` row, emits the Inngest event, returns 202.
 */
export async function createInvoice(
  db: Db,
  opts: {
    userId: string;
    mode: ApiKeyMode;
    input: CreateInvoiceInput;
    idempotencyKey?: string;
  }
): Promise<{ id: string; status: string; replayed: boolean }> {
  const [company] = await db
    .select()
    .from(companies)
    .where(and(eq(companies.id, opts.input.companyId), eq(companies.userId, opts.userId)))
    .limit(1);
  if (!company) {
    throw new ApiError({ code: 'COMPANY_NOT_FOUND', message: 'Company not found for this account' });
  }
  if (!company.grantId) {
    throw new ApiError({ code: 'GRANT_MISSING', message: 'Connect ANAF before creating invoices' });
  }
  if (opts.mode === 'live' && !company.spvVerifiedAt) {
    throw new ApiError({
      code: 'COMPANY_NOT_VERIFIED',
      message: 'SPV rights for this company are not verified — live invoicing is blocked. Re-check in the dashboard.',
    });
  }

  // Idempotent replay: return the existing invoice without consuming quota.
  if (opts.idempotencyKey) {
    const [existing] = await db
      .select({ id: invoices.id, status: invoices.status })
      .from(invoices)
      .where(and(eq(invoices.companyId, company.id), eq(invoices.idempotencyKey, opts.idempotencyKey)))
      .limit(1);
    if (existing) {
      return { id: existing.id, status: existing.status, replayed: true };
    }
  }

  await consumeDailyQuota(db, opts.userId, opts.mode);

  const totals = computeTotals(opts.input);
  let row: { id: string };
  try {
    [row] = await db
      .insert(invoices)
      .values({
        companyId: company.id,
        userId: opts.userId,
        direction: 'outbound',
        mode: opts.mode,
        status: 'queued',
        invoiceNumber: opts.input.invoiceNumber,
        issueDate: opts.input.issueDate,
        dueDate: opts.input.dueDate,
        currency: opts.input.currency ?? 'RON',
        totalAmount: totals.total,
        taxAmount: totals.tax,
        counterpartyCif: normalizeCui(opts.input.customerCui),
        requestInput: opts.input,
        idempotencyKey: opts.idempotencyKey,
      })
      .returning({ id: invoices.id });
  } catch (cause) {
    // Unique violation on (companyId, idempotencyKey) — a concurrent request won the race.
    if (opts.idempotencyKey && isUniqueViolation(cause)) {
      const [existing] = await db
        .select({ id: invoices.id, status: invoices.status })
        .from(invoices)
        .where(and(eq(invoices.companyId, company.id), eq(invoices.idempotencyKey, opts.idempotencyKey)))
        .limit(1);
      if (existing) return { id: existing.id, status: existing.status, replayed: true };
    }
    throw cause;
  }

  await inngest.send({ name: 'invoice/create.requested', data: { invoiceId: row.id } });
  return { id: row.id, status: 'queued', replayed: false };
}

function isUniqueViolation(cause: unknown): boolean {
  return Boolean(cause && typeof cause === 'object' && (cause as { code?: string }).code === '23505');
}

/** Serialize an invoice row for API responses. */
export function invoiceToApi(row: typeof invoices.$inferSelect, appUrl: string): Record<string, unknown> {
  return {
    id: row.id,
    companyId: row.companyId,
    direction: row.direction,
    mode: row.mode,
    status: row.status,
    invoiceNumber: row.invoiceNumber,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    currency: row.currency,
    totalAmount: row.totalAmount,
    taxAmount: row.taxAmount,
    counterpartyCif: row.counterpartyCif,
    counterpartyName: row.counterpartyName,
    anafUploadIndex: row.anafUploadIndex,
    anafDownloadId: row.anafDownloadId,
    error: row.error,
    createdAt: row.createdAt,
    finalizedAt: row.finalizedAt,
    links: {
      self: `${appUrl}/api/v1/invoices/${row.id}`,
      ...(row.xmlStorageKey ? { xml: `${appUrl}/api/v1/invoices/${row.id}/xml` } : {}),
      ...(row.zipStorageKey ? { zip: `${appUrl}/api/v1/invoices/${row.id}/zip` } : {}),
      ...(row.xmlStorageKey ? { pdf: `${appUrl}/api/v1/invoices/${row.id}/pdf` } : {}),
    },
  };
}
