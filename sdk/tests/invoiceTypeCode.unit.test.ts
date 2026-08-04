import { UblBuilder } from '../src/UblBuilder';
import { AnafValidationError } from '../src/errors';
import { InvoiceInput, InvoiceTypeCode } from '../src/types';
import { mockTestData } from './testUtils';

/**
 * Invoice type code (BT-3) tests.
 *
 * `InvoiceInput.invoiceTypeCode` selects the `cbc:InvoiceTypeCode` value from
 * the CIUS-RO accepted subset of UNTDID 1001 (380/384/389/751). When omitted it
 * defaults to '380', keeping the emitted XML byte-identical to prior versions.
 * Values outside the subset are rejected locally, before any upload to ANAF.
 */
describe('InvoiceTypeCode (BT-3) via invoiceTypeCode', () => {
  let builder: UblBuilder;

  beforeEach(() => {
    builder = new UblBuilder();
  });

  /** Deterministic base invoice so outputs can be compared byte-for-byte. */
  function buildInput(overrides: Partial<InvoiceInput> = {}): InvoiceInput {
    return {
      ...mockTestData.invoiceData,
      invoiceNumber: 'INV-2026-0001',
      issueDate: '2026-08-04',
      dueDate: '2026-09-03',
      ...overrides,
    };
  }

  describe('Default behaviour (backwards compatibility)', () => {
    test('emits InvoiceTypeCode 380 when invoiceTypeCode is omitted', () => {
      const xml = builder.generateInvoiceXml(buildInput());

      expect(xml).toContain('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>');
    });

    test('omitted invoiceTypeCode produces byte-identical XML to an explicit 380', () => {
      const defaultXml = builder.generateInvoiceXml(buildInput());
      const explicitXml = builder.generateInvoiceXml(buildInput({ invoiceTypeCode: '380' }));

      expect(defaultXml).toBe(explicitXml);
    });
  });

  describe('Explicit type codes', () => {
    test('emits InvoiceTypeCode 751 when requested', () => {
      const xml = builder.generateInvoiceXml(buildInput({ invoiceTypeCode: '751' }));

      expect(xml).toContain('<cbc:InvoiceTypeCode>751</cbc:InvoiceTypeCode>');
      expect(xml).not.toContain('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>');
    });

    test.each<InvoiceTypeCode>(['380', '384', '389', '751'])('accepts CIUS-RO code %s', (code) => {
      const xml = builder.generateInvoiceXml(buildInput({ invoiceTypeCode: code }));

      expect(xml).toContain(`<cbc:InvoiceTypeCode>${code}</cbc:InvoiceTypeCode>`);
    });

    test('a corrective (storno) invoice can be typed 384 explicitly', () => {
      const xml = builder.generateInvoiceXml(
        buildInput({
          invoiceTypeCode: '384',
          lines: [{ description: 'Storno servicii', quantity: -1, unitPrice: 100, taxPercent: 19 }],
          billingReference: { invoiceId: 'PA-2026-00042', issueDate: '2026-05-10' },
        })
      );

      expect(xml).toContain('<cbc:InvoiceTypeCode>384</cbc:InvoiceTypeCode>');
      expect(xml).toContain('<cac:BillingReference>');
    });
  });

  describe('Local validation of unknown codes', () => {
    test.each(['381', '386', '999', 'abc', ''])(
      "rejects '%s' locally with a clear message instead of an ANAF schematron rejection",
      (badCode) => {
        const input = buildInput({ invoiceTypeCode: badCode as InvoiceTypeCode });

        expect(() => builder.generateInvoiceXml(input)).toThrow(AnafValidationError);
        expect(() => builder.generateInvoiceXml(input)).toThrow(
          new RegExp(`Invoice type code '${badCode}' is not accepted by CIUS-RO`)
        );
        expect(() => builder.generateInvoiceXml(input)).toThrow(/380, 384, 389, 751/);
      }
    );
  });
});
