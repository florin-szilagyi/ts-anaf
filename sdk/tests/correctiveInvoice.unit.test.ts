import { UblBuilder } from '../src/UblBuilder';
import { InvoiceInput } from '../src/types';
import { mockTestData } from './testUtils';

/**
 * Corrective ("storno") invoice tests.
 *
 * A corrective invoice is a standard type-380 UBL Invoice that references a
 * preceding invoice (BG-3 / BT-25, BT-26) and carries negative line quantities
 * so it nets out as a reversal. Its presence is signalled solely by
 * `billingReference` on the InvoiceInput. Item net price stays non-negative
 * (BR-27); the sign lives on the quantity.
 */
describe('Corrective (storno) invoices via billingReference', () => {
  let builder: UblBuilder;

  beforeEach(() => {
    builder = new UblBuilder();
  });

  /** Base corrective invoice: a single reversed line of −1 × 100 @ 19% VAT. */
  function buildCorrective(overrides: Partial<InvoiceInput> = {}): InvoiceInput {
    return {
      ...mockTestData.invoiceData,
      currency: 'RON',
      isSupplierVatPayer: true,
      lines: [{ description: 'Storno servicii', quantity: -1, unitPrice: 100, taxPercent: 19 }],
      billingReference: { invoiceId: 'PA-2026-00042', issueDate: '2026-05-10' },
      ...overrides,
    };
  }

  describe('BillingReference (BG-3 / BT-25, BT-26)', () => {
    test('emits cac:BillingReference with the referenced invoice ID and issue date', () => {
      const xml = builder.generateInvoiceXml(buildCorrective());

      expect(xml).toContain('<cac:BillingReference>');
      expect(xml).toContain('<cac:InvoiceDocumentReference>');
      expect(xml).toContain('<cbc:ID>PA-2026-00042</cbc:ID>');
      // BT-26 present and formatted (matches issueDate formatting).
      expect(xml).toContain('<cbc:IssueDate>2026-05-10</cbc:IssueDate>');
    });

    test('omits cbc:IssueDate inside the reference when the referenced issueDate is not provided', () => {
      const xml = builder.generateInvoiceXml(
        buildCorrective({ billingReference: { invoiceId: 'PA-2026-00042' } })
      );

      expect(xml).toContain('<cac:BillingReference>');
      expect(xml).toContain('<cbc:ID>PA-2026-00042</cbc:ID>');

      // The only IssueDate must be the invoice header's, not one inside the reference.
      const refStart = xml.indexOf('<cac:BillingReference>');
      const refEnd = xml.indexOf('</cac:BillingReference>', refStart);
      const refSection = xml.substring(refStart, refEnd);
      expect(refSection).not.toContain('<cbc:IssueDate>');
    });

    test('accepts a Date object for the referenced issueDate', () => {
      const xml = builder.generateInvoiceXml(
        buildCorrective({ billingReference: { invoiceId: 'PA-2026-00042', issueDate: new Date('2026-05-10') } })
      );

      expect(xml).toContain('<cbc:IssueDate>2026-05-10</cbc:IssueDate>');
    });

    test('places BillingReference after InvoicePeriod and before AccountingSupplierParty (UBL ordering)', () => {
      const xml = builder.generateInvoiceXml(buildCorrective({ invoicePeriodEndDate: '2026-05-31' }));

      const periodIdx = xml.indexOf('<cac:InvoicePeriod>');
      const billingIdx = xml.indexOf('<cac:BillingReference>');
      const supplierIdx = xml.indexOf('cac:AccountingSupplierParty');

      expect(periodIdx).toBeGreaterThan(-1);
      expect(periodIdx).toBeLessThan(billingIdx);
      expect(billingIdx).toBeLessThan(supplierIdx);
    });
  });

  describe('Negative amounts (allowed because billingReference is present)', () => {
    test('emits a negative LineExtensionAmount and negative PayableAmount (not clamped to 0)', () => {
      const xml = builder.generateInvoiceXml(buildCorrective());

      // Line net: −1 × 100 = −100.00
      expect(xml).toContain('<cbc:LineExtensionAmount currencyID="RON">-100.00</cbc:LineExtensionAmount>');
      // Tax: −100 × 0.19 = −19.00 → grand total −119.00, payable −119.00 (NOT clamped).
      expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="RON">-119.00</cbc:TaxInclusiveAmount>');
      expect(xml).toContain('<cbc:PayableAmount currencyID="RON">-119.00</cbc:PayableAmount>');
    });

    test('keeps the item net price (cac:Price/cbc:PriceAmount) positive — BR-27', () => {
      const xml = builder.generateInvoiceXml(buildCorrective());

      const priceStart = xml.indexOf('<cac:Price>');
      const priceEnd = xml.indexOf('</cac:Price>', priceStart);
      const priceSection = xml.substring(priceStart, priceEnd);

      // The sign lives on the quantity, never the price.
      expect(priceSection).toContain('<cbc:PriceAmount currencyID="RON">100.00</cbc:PriceAmount>');
      expect(priceSection).not.toContain('-100.00');
      // The reversal sign is on the quantity.
      expect(xml).toMatch(/<cbc:InvoicedQuantity[^>]*>-1<\/cbc:InvoicedQuantity>/);
    });

    test('still emits InvoiceTypeCode 380 (not a credit note)', () => {
      const xml = builder.generateInvoiceXml(buildCorrective());

      expect(xml).toContain('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>');
    });

    test('voucher-reversal totals: negative line + document-level charge net out correctly', () => {
      // Line −100 (qty −1 × 100 @ 19%) re-expresses a voucher reversal as a +20 CHARGE.
      // TaxExclusive = −100 + 20 = −80.00; tax = −80 × 0.19 = −15.20; payable = −95.20.
      const xml = builder.generateInvoiceXml(
        buildCorrective({
          documentAllowanceCharges: [{ chargeIndicator: true, amount: 20, reason: 'Storno voucher' }],
        })
      );

      expect(xml).toContain('<cbc:LineExtensionAmount currencyID="RON">-100.00</cbc:LineExtensionAmount>');
      expect(xml).toContain('<cbc:ChargeTotalAmount currencyID="RON">20.00</cbc:ChargeTotalAmount>');
      expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="RON">-80.00</cbc:TaxExclusiveAmount>');
      expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="RON">-95.20</cbc:TaxInclusiveAmount>');
      expect(xml).toContain('<cbc:PayableAmount currencyID="RON">-95.20</cbc:PayableAmount>');
    });
  });

  describe('Regression: normal invoices are unchanged', () => {
    test('a normal invoice (no billingReference) still throws on quantity < 0', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: [{ description: 'Service', quantity: -1, unitPrice: 100, taxPercent: 19 }],
      };

      expect(() => builder.generateInvoiceXml(invoiceData)).toThrow(/Quantity must be a positive number/);
    });

    test('a normal invoice still throws on quantity === 0', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: [{ description: 'Service', quantity: 0, unitPrice: 100, taxPercent: 19 }],
      };

      expect(() => builder.generateInvoiceXml(invoiceData)).toThrow(/Quantity must be a non-zero number/);
    });

    test('a corrective invoice still throws on quantity === 0 (zero is never a valid reversal)', () => {
      expect(() =>
        builder.generateInvoiceXml(
          buildCorrective({ lines: [{ description: 'Storno', quantity: 0, unitPrice: 100, taxPercent: 19 }] })
        )
      ).toThrow(/Quantity must be a non-zero number/);
    });

    test('a normal invoice emits no cac:BillingReference', () => {
      const xml = builder.generateInvoiceXml(mockTestData.invoiceData);

      expect(xml).not.toContain('cac:BillingReference');
      expect(xml).not.toContain('cac:InvoiceDocumentReference');
    });
  });
});
