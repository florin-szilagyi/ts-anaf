import { z } from 'zod';
import { ApiError } from '../errors';

/**
 * Request schema for POST /api/v1/invoices (and the dashboard form, which
 * submits the same shape). Derived from the CLI's ublBuildInputSchema
 * (cli/src/actions/ublBuildAction.ts) — `context`/`output` replaced by
 * `companyId`, pipe-string lines dropped in favor of structured objects.
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

const partyOverrideSchema = z
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

export const createInvoiceSchema = z
  .object({
    /** fastbill company id (uuid) — the supplier. */
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

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;

export function parseCreateInvoice(body: unknown): CreateInvoiceInput {
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
