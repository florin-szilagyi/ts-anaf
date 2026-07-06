import { createInvoiceSchema, type ParsedCreateInvoiceInput } from '@florinszilagyi/fastbill-sdk';
import { ApiError } from '../errors';

/**
 * The request contract lives in @florinszilagyi/fastbill-sdk (single source of
 * truth shared with the published client). This module only adds the
 * server-side ApiError envelope on validation failure. Server-side code works
 * with the parsed shape (zod defaults applied).
 */

export { createInvoiceSchema, invoiceLineSchema } from '@florinszilagyi/fastbill-sdk';
export type { ParsedCreateInvoiceInput as CreateInvoiceInput } from '@florinszilagyi/fastbill-sdk';

export function parseCreateInvoice(body: unknown): ParsedCreateInvoiceInput {
  const parsed = createInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError({
      code: 'INVALID_INVOICE_INPUT',
      message: 'Invoice payload failed validation',
      details: { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
    });
  }
  return parsed.data;
}
