import { and, eq, type SQL } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import type { Db } from '@/db';
import { companies, invoices, type ApiKeyMode } from '@/db/schema';
import { getToolsClient } from '../anaf/gateway';
import { ApiError } from '../errors';
import { getObject, presignDownload, putObject, storageKeys } from '../storage';

export type InvoiceFileKind = 'xml' | 'zip' | 'pdf';

export interface InvoiceFileContext {
  db: Db;
  userId: string;
  /** API-key requests are mode-scoped; the dashboard sees both modes. */
  mode?: ApiKeyMode;
}

/**
 * Shared download logic for invoice files (public API + dashboard) — 302 to a
 * short-lived presigned URL. The PDF is generated lazily on first request via
 * ANAF's transformare endpoint, then cached to storage.
 */
export async function invoiceFileResponse(
  ctx: InvoiceFileContext,
  invoiceId: string,
  kind: InvoiceFileKind
): Promise<NextResponse> {
  const filters: SQL[] = [eq(invoices.id, invoiceId), eq(invoices.userId, ctx.userId)];
  if (ctx.mode) filters.push(eq(invoices.mode, ctx.mode));
  const [row] = await ctx.db
    .select()
    .from(invoices)
    .where(and(...filters))
    .limit(1);
  if (!row) throw new ApiError({ code: 'NOT_FOUND', message: 'Invoice not found' });

  const filenameBase = row.invoiceNumber?.replace(/[^\w-]+/g, '_') || row.id;

  if (kind === 'xml') {
    if (!row.xmlStorageKey) throw new ApiError({ code: 'NOT_FOUND', message: 'No XML stored for this invoice yet' });
    return redirect(await presignDownload(row.xmlStorageKey, { filename: `${filenameBase}.xml` }));
  }

  if (kind === 'zip') {
    if (!row.zipStorageKey)
      throw new ApiError({ code: 'NOT_FOUND', message: 'No signed ZIP stored for this invoice yet' });
    return redirect(await presignDownload(row.zipStorageKey, { filename: `${filenameBase}.zip` }));
  }

  // PDF — lazy generation from the stored XML.
  if (row.pdfStorageKey) {
    return redirect(await presignDownload(row.pdfStorageKey, { filename: `${filenameBase}.pdf` }));
  }
  if (!row.xmlStorageKey) {
    throw new ApiError({ code: 'NOT_FOUND', message: 'No XML stored for this invoice yet' });
  }
  const [company] = await ctx.db.select().from(companies).where(eq(companies.id, row.companyId)).limit(1);
  if (!company?.grantId) {
    throw new ApiError({ code: 'GRANT_MISSING', message: 'Company has no ANAF connection' });
  }
  const xml = await getObject(row.xmlStorageKey);
  const tools = await getToolsClient(ctx.db, { grantId: company.grantId });
  const pdf = await tools.convertXmlToPdfNoValidation(xml.toString('utf8'));
  const pdfKey = storageKeys.invoicePdf(row.userId, row.id);
  await putObject(pdfKey, pdf, 'application/pdf');
  await ctx.db.update(invoices).set({ pdfStorageKey: pdfKey }).where(eq(invoices.id, row.id));
  return redirect(await presignDownload(pdfKey, { filename: `${filenameBase}.pdf` }));
}

function redirect(url: string): NextResponse {
  return NextResponse.redirect(url, { status: 302 });
}
