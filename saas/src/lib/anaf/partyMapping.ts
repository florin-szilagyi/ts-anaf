import {
  UblBuilder,
  companyToParty,
  mergePartyOverride,
  type AnafCompanyData,
  type InvoiceInput,
  type Party,
} from '@florinszilagyi/anaf-ts-sdk';
import { ApiError } from '../errors';
import type { CreateInvoiceInput } from '../validation/invoiceInput';
import { getDetailsClient } from './gateway';

/** Strip the RO prefix — fastbill stores and sends bare digits. */
export function normalizeCui(cui: string): string {
  return cui.trim().toUpperCase().replace(/^RO/, '');
}

export interface BuiltInvoice {
  xml: string;
  invoice: InvoiceInput;
  supplier: Party;
  customer: Party;
}

/**
 * Build CIUS-RO UBL XML from a validated API payload. Supplier + customer are
 * resolved via the public ANAF registry, mapped with the SDK's Romanian party
 * mapping (county codes, Bucharest sectors, VAT-payer detection), then
 * overridden with any caller-provided fields.
 */
export async function buildUblFromInput(
  input: CreateInvoiceInput,
  supplierCif: string,
  lookupClient = getDetailsClient()
): Promise<BuiltInvoice> {
  const supplierCui = normalizeCui(supplierCif);
  const customerCui = normalizeCui(input.customerCui);

  const result = await lookupClient.batchGetCompanyData([supplierCui, customerCui]);
  if (!result.success || !result.data) {
    throw new ApiError({
      code: 'ANAF_ERROR',
      message: 'ANAF company lookup failed',
      details: { error: result.error },
    });
  }
  const byCui = new Map<string, AnafCompanyData>(result.data.map((c) => [normalizeCui(c.vatCode), c]));
  const supplierData = byCui.get(supplierCui);
  const customerData = byCui.get(customerCui);
  if (!supplierData || !customerData) {
    throw new ApiError({
      code: 'INVALID_INVOICE_INPUT',
      message: `Company lookup returned no data for CUI ${!supplierData ? supplierCui : customerCui}`,
      details: { supplierCui, customerCui },
    });
  }

  const supplier = mergePartyOverride(companyToParty(supplierData, supplierCui), input.overrides?.supplier);
  const customer = mergePartyOverride(companyToParty(customerData, customerCui), input.overrides?.customer);

  const invoice: InvoiceInput = {
    invoiceNumber: input.invoiceNumber,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    currency: input.currency ?? 'RON',
    note: input.note,
    supplier,
    customer,
    lines: input.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxPercent: l.taxPercent,
      ...(l.unitCode ? { unitCode: l.unitCode } : {}),
    })),
    paymentIban: input.paymentIban,
    isSupplierVatPayer: supplier.vatNumber !== undefined,
    taxCurrencyTaxAmount: input.taxCurrencyTaxAmount,
  };

  let xml: string;
  try {
    xml = new UblBuilder().generateInvoiceXml(invoice);
  } catch (cause) {
    throw new ApiError({
      code: 'INVALID_INVOICE_INPUT',
      message: `UBL build failed: ${(cause as Error).message}`,
      details: { invoiceNumber: input.invoiceNumber },
    });
  }

  return { xml, invoice, supplier, customer };
}

/** Totals for invoice metadata columns (mirror of the UBL builder's math). */
export function computeTotals(input: CreateInvoiceInput): { total: string; tax: string } {
  let net = 0;
  let tax = 0;
  for (const l of input.lines) {
    const lineNet = l.quantity * l.unitPrice;
    net += lineNet;
    tax += lineNet * (l.taxPercent / 100);
  }
  const round = (n: number) => (Math.round(n * 100) / 100).toFixed(2);
  return { total: round(net + tax), tax: round(tax) };
}
