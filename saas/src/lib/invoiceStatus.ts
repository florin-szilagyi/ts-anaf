import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { invoices, type InvoiceStatus } from '@/db/schema';

/**
 * Outbound invoice lifecycle. Every transition goes through
 * `transitionInvoice` with a compare-and-set (`WHERE status = expected`) so
 * duplicate Inngest step replays and concurrent writers cannot corrupt state.
 *
 *   queued → building → uploaded → processing → validated | rejected
 *   any non-terminal → failed
 */
const ALLOWED: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  queued: ['building', 'failed'],
  building: ['uploaded', 'failed'],
  uploaded: ['processing', 'validated', 'rejected', 'failed'],
  processing: ['processing', 'validated', 'rejected', 'failed'],
  validated: [],
  rejected: [],
  failed: [],
  received: [],
};

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

export interface TransitionPatch {
  anafUploadIndex?: string;
  anafDownloadId?: string;
  xmlStorageKey?: string;
  zipStorageKey?: string;
  pdfStorageKey?: string;
  error?: unknown;
  finalizedAt?: Date;
}

/**
 * Compare-and-set status transition. Returns true when the row moved; false
 * when the invoice was not in `from` anymore (already-applied replay — treat
 * as a no-op, not an error).
 */
export async function transitionInvoice(
  db: Db,
  invoiceId: string,
  from: InvoiceStatus,
  to: InvoiceStatus,
  patch: TransitionPatch = {}
): Promise<boolean> {
  if (!canTransition(from, to)) {
    throw new Error(`illegal invoice transition ${from} -> ${to}`);
  }
  const res = await db
    .update(invoices)
    .set({ status: to, updatedAt: sql`now()`, ...cleanPatch(patch) })
    .where(and(eq(invoices.id, invoiceId), eq(invoices.status, from)))
    .returning({ id: invoices.id });
  return res.length > 0;
}

function cleanPatch(patch: TransitionPatch): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
}

export const TERMINAL_STATUSES: readonly InvoiceStatus[] = ['validated', 'rejected', 'failed', 'received'];
