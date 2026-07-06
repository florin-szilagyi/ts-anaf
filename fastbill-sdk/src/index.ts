/**
 * fastbill SDK — typed client for the fastbill e-Factura API.
 *
 * @example
 * ```typescript
 * import { FastbillClient } from '@florinszilagyi/fastbill-sdk';
 *
 * const fastbill = new FastbillClient({ apiKey: process.env.FASTBILL_API_KEY! });
 * const { id } = await fastbill.createInvoice({
 *   companyId: '…',
 *   invoiceNumber: 'FB-0042',
 *   issueDate: '2026-07-01',
 *   customerCui: 'RO12345678',
 *   lines: [{ description: 'Consulting', quantity: 10, unitPrice: 100, taxPercent: 19 }],
 * });
 * const invoice = await fastbill.waitForInvoice(id);   // polls until validated/rejected
 * const pdf = await fastbill.downloadPdf(id);
 * ```
 */

export { FastbillClient, type FastbillClientConfig } from './client';
export { FastbillApiError, FastbillRateLimitError, FastbillTimeoutError } from './errors';
export {
  createInvoiceSchema,
  invoiceLineSchema,
  partyOverrideSchema,
  invoiceDirections,
  invoiceStatuses,
  TERMINAL_INVOICE_STATUSES,
  API_ERROR_CODES,
  type CreateInvoiceInput,
  type ParsedCreateInvoiceInput,
  type InvoiceLineInput,
  type InvoiceResource,
  type CompanyResource,
  type CreateInvoiceResult,
  type ListInvoicesResult,
  type ListInvoicesFilters,
  type ValidateResult,
  type InvoiceDirection,
  type InvoiceStatus,
  type ApiMode,
  type FastbillErrorCode,
} from './schemas';
