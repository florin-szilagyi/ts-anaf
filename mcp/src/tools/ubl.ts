import { z } from 'zod';
import type { UblBuilder, InvoiceInput } from '@florinszilagyi/anaf-ts-sdk';
import { McpToolError, formatToolError } from '../errors.js';
import type { ToolResult } from './lookup.js';

const addressSchema = z.object({
  street: z.string(),
  city: z.string(),
  postalZone: z.string(),
  county: z.string().optional(),
  countryCode: z.string().default('RO'),
});

const partySchema = z.object({
  registrationName: z.string(),
  companyId: z.string(),
  vatNumber: z.string().optional(),
  address: addressSchema,
  email: z.string().optional(),
  telephone: z.string().optional(),
  partyIdentificationId: z.string().optional(),
});

const lineSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  description: z.string(),
  quantity: z.number(),
  unitCode: z.string().optional(),
  unitPrice: z.number(),
  taxPercent: z.number().optional(),
});

export const buildUblInputSchema = z.object({
  invoiceNumber: z.string(),
  issueDate: z.string().describe('ISO date string (YYYY-MM-DD)'),
  dueDate: z.string().optional(),
  currency: z.string().optional(),
  note: z.string().optional(),
  invoicePeriodEndDate: z.string().optional(),
  supplier: partySchema,
  customer: partySchema,
  lines: z.array(lineSchema).min(1),
  paymentIban: z.string().optional(),
  isSupplierVatPayer: z.boolean().optional(),
  taxCurrencyTaxAmount: z.number().optional(),
});

export type BuildUblInput = z.infer<typeof buildUblInputSchema>;

export interface UblDeps {
  builder: Pick<UblBuilder, 'generateInvoiceXml'>;
}

export async function handleBuildUbl(input: BuildUblInput, deps: UblDeps): Promise<ToolResult> {
  try {
    const xml = deps.builder.generateInvoiceXml(input as unknown as InvoiceInput);
    return { content: [{ type: 'text', text: xml }] };
  } catch (err) {
    const wrapped = new McpToolError({
      code: 'UBL_BUILD_FAILED',
      message: err instanceof Error ? err.message : String(err),
      category: 'user_input',
      details: { invoiceNumber: input.invoiceNumber },
    });
    return {
      content: [{ type: 'text', text: formatToolError(wrapped) }],
      isError: true,
    };
  }
}

export const BUILD_UBL_TOOL_DEFINITION = {
  name: 'anaf_build_ubl',
  description:
    'Generate a CIUS-RO compliant UBL 2.1 invoice XML from structured invoice data. Returns the XML as text. No ANAF authentication needed.',
  inputSchema: buildUblInputSchema,
};
