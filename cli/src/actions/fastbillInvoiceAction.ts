import { z } from 'zod';
import { CliError } from '../output/errors';
import { parseInvoiceLine } from './lineParser';
import type { FastbillInvoiceAction, InvoiceLineAction } from './types';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');
const cuiPattern = /^(RO)?\d{2,10}$/i;

const lineObjectSchema = z
  .object({
    description: z.string().min(1),
    quantity: z.number().positive(),
    unitPrice: z.number().nonnegative(),
    taxPercent: z.number().min(0).max(100).default(0),
    unitCode: z.string().min(1).optional(),
  })
  .strict();

const lineInputSchema = z.union([z.string().min(1), lineObjectSchema]);

export const fastbillInvoiceInputSchema = z
  .object({
    companyId: z.string().uuid('companyId must be the fastbill company uuid (see `fastbill companies`)'),
    invoiceNumber: z.string().min(1),
    issueDate: isoDate,
    dueDate: isoDate.optional(),
    customerCui: z.string().regex(cuiPattern, 'customerCui must be a Romanian CUI'),
    lines: z.array(lineInputSchema).min(1),
    currency: z.string().length(3).optional(),
    taxCurrencyTaxAmount: z.number().nonnegative().optional(),
    note: z.string().min(1).optional(),
    paymentIban: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1).optional(),
    wait: z.boolean().optional(),
    timeoutMinutes: z.number().positive().optional(),
  })
  .strict();

export type FastbillInvoiceInput = z.input<typeof fastbillInvoiceInputSchema>;

export function normalizeFastbillInvoiceAction(input: FastbillInvoiceInput): FastbillInvoiceAction {
  const parsed = fastbillInvoiceInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CliError({
      code: 'INVALID_FASTBILL_INPUT',
      message: `fastbill invoice input failed validation: ${parsed.error.message}`,
      category: 'user_input',
      details: { issues: parsed.error.issues },
    });
  }
  const data = parsed.data;

  const lines: InvoiceLineAction[] = data.lines.map((line) =>
    typeof line === 'string' ? parseInvoiceLine(line) : line
  );

  return {
    kind: 'fastbill.invoice',
    invoice: {
      companyId: data.companyId,
      invoiceNumber: data.invoiceNumber,
      issueDate: data.issueDate,
      dueDate: data.dueDate,
      customerCui: data.customerCui,
      lines,
      currency: data.currency,
      taxCurrencyTaxAmount: data.taxCurrencyTaxAmount,
      note: data.note,
      paymentIban: data.paymentIban,
    },
    idempotencyKey: data.idempotencyKey,
    wait: data.wait,
    timeoutMinutes: data.timeoutMinutes,
  };
}
