import { z } from 'zod';
import { CliError } from '../output/errors';
import { parseInvoiceLine } from './lineParser';
import type { InvoiceLineAction, InvoiceOverrides, OutputTarget, UblBuildAction } from './types';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

const cuiPattern = /^(RO)?\d{2,10}$/i;

const lineObjectSchema = z
  .object({
    description: z.string().min(1),
    quantity: z.number().nonnegative(),
    unitPrice: z.number().nonnegative(),
    taxPercent: z.number().nonnegative(),
    unitCode: z.string().min(1).optional(),
  })
  .strict();

const lineInputSchema = z.union([z.string().min(1), lineObjectSchema]);

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

const overridesSchema = z
  .object({
    supplier: partyOverrideSchema.optional(),
    customer: partyOverrideSchema.optional(),
    note: z.string().min(1).optional(),
    paymentIban: z.string().min(1).optional(),
    currency: z.string().min(1).optional(),
    dueDate: z.string().min(1).optional(),
  })
  .strict();

const outputSchema = z
  .object({
    mode: z.enum(['stdout', 'file']).optional(),
    path: z.string().min(1).optional(),
  })
  .strict()
  .optional();

export const ublBuildInputSchema = z
  .object({
    context: z.string().min(1),
    invoiceNumber: z.string().min(1),
    issueDate: z.string().min(1),
    dueDate: z.string().optional(),
    customerCui: z.string().min(1),
    lines: z.array(lineInputSchema).min(1),
    invoiceTypeCode: z.enum(['380', '384', '389', '751']).optional(),
    currency: z.string().min(1).optional(),
    taxCurrencyTaxAmount: z.number().nonnegative().optional(),
    note: z.string().min(1).optional(),
    paymentIban: z.string().min(1).optional(),
    overrides: overridesSchema.optional(),
    output: outputSchema,
  })
  .strict();

export type UblBuildInput = z.infer<typeof ublBuildInputSchema>;

export function normalizeUblBuildAction(input: UblBuildInput): UblBuildAction {
  const parsed = ublBuildInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new CliError({
      code: 'INVALID_INVOICE_INPUT',
      message: `ubl build input failed validation: ${parsed.error.message}`,
      category: 'user_input',
      details: { issues: parsed.error.issues },
    });
  }
  const data = parsed.data;

  if (!isoDate.safeParse(data.issueDate).success) {
    throw new CliError({
      code: 'INVALID_DATE',
      message: `issueDate must be YYYY-MM-DD (got "${data.issueDate}")`,
      category: 'user_input',
      details: { field: 'issueDate', value: data.issueDate },
    });
  }
  if (data.dueDate && !isoDate.safeParse(data.dueDate).success) {
    throw new CliError({
      code: 'INVALID_DATE',
      message: `dueDate must be YYYY-MM-DD (got "${data.dueDate}")`,
      category: 'user_input',
      details: { field: 'dueDate', value: data.dueDate },
    });
  }

  if (!cuiPattern.test(data.customerCui)) {
    throw new CliError({
      code: 'INVALID_CUI',
      message: `customerCui must match ${cuiPattern} (got "${data.customerCui}")`,
      category: 'user_input',
      details: { field: 'customerCui', value: data.customerCui },
    });
  }

  const lines: InvoiceLineAction[] = data.lines.map((line) =>
    typeof line === 'string' ? parseInvoiceLine(line) : line
  );

  const output = normalizeOutput(data.output);

  const action: UblBuildAction = {
    kind: 'ubl.build',
    context: data.context,
    invoice: {
      invoiceNumber: data.invoiceNumber,
      issueDate: data.issueDate,
      dueDate: data.dueDate,
      customerCui: data.customerCui,
      lines,
      invoiceTypeCode: data.invoiceTypeCode,
      currency: data.currency,
      taxCurrencyTaxAmount: data.taxCurrencyTaxAmount,
      note: data.note,
      paymentIban: data.paymentIban,
      overrides: data.overrides as InvoiceOverrides | undefined,
    },
    output,
  };
  return action;
}

export function normalizeOutput(input?: { mode?: 'stdout' | 'file'; path?: string }): OutputTarget {
  if (!input || !input.mode || input.mode === 'stdout') {
    return { mode: 'stdout' };
  }
  if (!input.path) {
    throw new CliError({
      code: 'INVALID_OUTPUT_TARGET',
      message: 'output mode "file" requires a path',
      category: 'user_input',
    });
  }
  return { mode: 'file', path: input.path };
}
