import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { extractInvoiceMetadata, pickInvoiceXml } from '@/lib/anaf/ublMetadata';

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2">
  <cbc:ID>FB-0042</cbc:ID>
  <cbc:IssueDate>2026-07-01</cbc:IssueDate>
  <cbc:DueDate>2026-07-31</cbc:DueDate>
  <cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>ACME S.R.L. &amp; Co</cbc:RegistrationName>
        <cbc:CompanyID>RO11111111</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Client SRL</cbc:RegistrationName>
        <cbc:CompanyID>22222222</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="RON">38.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="RON">238.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
</Invoice>`;

describe('ublMetadata', () => {
  it('extracts header fields from CIUS-RO XML', () => {
    const meta = extractInvoiceMetadata(SAMPLE_XML);
    expect(meta.invoiceNumber).toBe('FB-0042');
    expect(meta.issueDate).toBe('2026-07-01');
    expect(meta.dueDate).toBe('2026-07-31');
    expect(meta.currency).toBe('RON');
    expect(meta.totalAmount).toBe('238.00');
    expect(meta.taxAmount).toBe('38.00');
    expect(meta.supplierCif).toBe('11111111');
    expect(meta.supplierName).toBe('ACME S.R.L. & Co');
    expect(meta.customerCif).toBe('22222222');
    expect(meta.customerName).toBe('Client SRL');
  });

  it('picks the invoice XML from an ANAF ZIP, skipping the signature file', () => {
    const zip = zipSync({
      'semnatura_12345.xml': new TextEncoder().encode('<sig/>'),
      '12345.xml': new TextEncoder().encode(SAMPLE_XML),
    });
    const xml = pickInvoiceXml(Buffer.from(zip));
    expect(xml).not.toBeNull();
    expect(xml!.toString('utf8')).toContain('FB-0042');
  });

  it('returns null for ZIPs without XML', () => {
    const zip = zipSync({ 'readme.txt': new TextEncoder().encode('hi') });
    expect(pickInvoiceXml(Buffer.from(zip))).toBeNull();
  });
});
