import { z } from 'zod';

/**
 * The canonical fastbill API request contract. The fastbill server imports
 * these schemas for validation, so client and server cannot drift.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const cuiPattern = /^(RO)?\d{2,10}$/i;

export const invoiceLineSchema = z
  .object({
    description: z.string().min(1),
    quantity: z.number().positive(),
    unitPrice: z.number().nonnegative(),
    taxPercent: z.number().min(0).max(100).default(0),
    unitCode: z.string().min(1).optional(),
  })
  .strict();

export const partyOverrideSchema = z
  .object({
    registrationName: z.string().min(1).optional(),
    companyId: z.string().min(1).optional(),
    vatNumber: z.string().min(1).optional(),
    email: z.string().min(1).optional(),
    telephone: z.string().min(1).optional(),
    partyIdentificationId: z.string().min(1).optional(),
    address: z
      .object({
        street: z.string().min(1).optional(),
        city: z.string().min(1).optional(),
        postalZone: z.string().min(1).optional(),
        county: z.string().min(1).optional(),
        countryCode: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

/** Request body for POST /api/v1/invoices and POST /api/v1/validate. */
export const createInvoiceSchema = z
  .object({
    /** fastbill company id (uuid) — the supplier. From GET /api/v1/companies. */
    companyId: z.string().uuid(),
    invoiceNumber: z.string().min(1).max(64),
    issueDate: isoDate,
    dueDate: isoDate.optional(),
    customerCui: z.string().regex(cuiPattern, 'must be a Romanian CUI, e.g. RO12345678 or 12345678'),
    lines: z.array(invoiceLineSchema).min(1).max(100),
    currency: z.string().length(3).optional(),
    /** BT-111: VAT total in RON, required for non-RON invoices. */
    taxCurrencyTaxAmount: z.number().nonnegative().optional(),
    note: z.string().min(1).max(1000).optional(),
    paymentIban: z.string().min(1).optional(),
    overrides: z
      .object({
        supplier: partyOverrideSchema.optional(),
        customer: partyOverrideSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type InvoiceLineInput = z.input<typeof invoiceLineSchema>;
export type CreateInvoiceInput = z.input<typeof createInvoiceSchema>;
/** Post-parse shape (defaults applied, e.g. taxPercent always present). */
export type ParsedCreateInvoiceInput = z.output<typeof createInvoiceSchema>;

// ---------- response resources ----------

export const invoiceDirections = ['outbound', 'inbound'] as const;
export type InvoiceDirection = (typeof invoiceDirections)[number];

export const invoiceStatuses = [
  'queued',
  'building',
  'uploaded',
  'processing',
  'validated',
  'rejected',
  'failed',
  'received',
] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

export const TERMINAL_INVOICE_STATUSES: readonly InvoiceStatus[] = ['validated', 'rejected', 'failed', 'received'];

export type ApiMode = 'test' | 'live';

export interface InvoiceResource {
  id: string;
  companyId: string;
  direction: InvoiceDirection;
  mode: ApiMode;
  status: InvoiceStatus;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  totalAmount: string | null;
  taxAmount: string | null;
  counterpartyCif: string | null;
  counterpartyName: string | null;
  anafUploadIndex: string | null;
  anafDownloadId: string | null;
  error: unknown;
  createdAt: string;
  finalizedAt: string | null;
  links: { self: string; xml?: string; zip?: string; pdf?: string };
}

export interface CompanyResource {
  id: string;
  cif: string;
  name: string;
  vatPayer: boolean;
  spvVerified: boolean;
  archiveEnabled: boolean;
  lastSyncAt: string | null;
}

export interface CreateInvoiceResult {
  id: string;
  status: InvoiceStatus;
  /** True when an Idempotency-Key replay returned an existing invoice (HTTP 200 instead of 202). */
  replayed: boolean;
  links?: { self: string };
}

export interface ListInvoicesResult {
  invoices: Array<InvoiceResource & { companyCif?: string }>;
  nextCursor: string | null;
}

export interface ValidateResult {
  valid: boolean;
  details: string | null;
  info: string | null;
}

export interface ListInvoicesFilters {
  direction?: InvoiceDirection;
  status?: InvoiceStatus;
  /** Issue-date range, YYYY-MM-DD. */
  from?: string;
  to?: string;
  counterpartyCif?: string;
  companyId?: string;
  limit?: number;
  cursor?: string;
}

// ---------- error codes ----------

export const API_ERROR_CODES = [
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'INVALID_INVOICE_INPUT',
  'INVALID_REQUEST',
  'COMPANY_NOT_FOUND',
  'COMPANY_NOT_VERIFIED',
  'GRANT_MISSING',
  'GRANT_EXPIRED',
  'QUOTA_EXCEEDED',
  'RATE_LIMITED',
  'IDEMPOTENCY_CONFLICT',
  'ANAF_ERROR',
  'INTERNAL',
] as const;

export type FastbillErrorCode = (typeof API_ERROR_CODES)[number];
