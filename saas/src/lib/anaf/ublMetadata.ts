import { unzipSync } from 'fflate';

/**
 * Lightweight metadata extraction from ANAF document ZIPs. The ZIP contains
 * the invoice XML (and an ANAF signature file); we pull just the columns the
 * archive table needs. Regex-based on purpose — ANAF XML is machine-generated
 * UBL and we only need scalar header fields; the full XML stays in storage.
 */

export interface InvoiceMetadata {
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
  currency?: string;
  totalAmount?: string;
  taxAmount?: string;
  supplierCif?: string;
  supplierName?: string;
  customerCif?: string;
  customerName?: string;
}

/** Pick the invoice XML entry from an ANAF document ZIP (skips signature files). */
export function pickInvoiceXml(zip: Buffer | Uint8Array): Buffer | null {
  const entries = unzipSync(new Uint8Array(zip));
  const names = Object.keys(entries);
  // ANAF ZIPs contain "<id>.xml" (the invoice) and "semnatura_<id>.xml".
  const candidate =
    names.find((n) => n.toLowerCase().endsWith('.xml') && !/semnatura/i.test(n)) ??
    names.find((n) => n.toLowerCase().endsWith('.xml'));
  if (!candidate) return null;
  return Buffer.from(entries[candidate]);
}

export function extractInvoiceMetadata(xml: string): InvoiceMetadata {
  const supplierBlock = block(xml, 'AccountingSupplierParty');
  const customerBlock = block(xml, 'AccountingCustomerParty');
  return {
    invoiceNumber: first(xml, /<cbc:ID[^>]*>([^<]+)<\/cbc:ID>/),
    issueDate: first(xml, /<cbc:IssueDate[^>]*>(\d{4}-\d{2}-\d{2})/),
    dueDate: first(xml, /<cbc:DueDate[^>]*>(\d{4}-\d{2}-\d{2})/),
    currency: first(xml, /<cbc:DocumentCurrencyCode[^>]*>([A-Z]{3})/),
    totalAmount: first(xml, /<cbc:PayableAmount[^>]*>([\d.]+)</),
    taxAmount: first(xml, /<cbc:TaxAmount[^>]*>([\d.]+)</),
    supplierCif: cifFrom(supplierBlock),
    supplierName: first(supplierBlock, /<cbc:RegistrationName[^>]*>([^<]+)</),
    customerCif: cifFrom(customerBlock),
    customerName: first(customerBlock, /<cbc:RegistrationName[^>]*>([^<]+)</),
  };
}

function block(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<cac:${tag}[\\s\\S]*?</cac:${tag}>`));
  return m?.[0] ?? '';
}

function first(s: string, re: RegExp): string | undefined {
  const m = s.match(re);
  const v = m?.[1]?.trim();
  return v ? decodeEntities(v) : undefined;
}

function cifFrom(partyBlock: string): string | undefined {
  const companyId = first(partyBlock, /<cbc:CompanyID[^>]*>([^<]+)</);
  return companyId?.replace(/^RO/i, '');
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
