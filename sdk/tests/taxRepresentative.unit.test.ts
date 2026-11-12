import { UblBuilder } from '../src/UblBuilder';
import { AnafValidationError } from '../src/errors';
import { InvoiceInput, TaxRepresentative } from '../src/types';
import { parseReceivedInvoice } from '../src/ubl/receivedInvoice';
import { mockTestData } from './testUtils';

/**
 * Seller tax representative (BG-11, BG-12) and contact point name (BT-41, BT-56).
 * Every party below is synthetic.
 */
describe('Tax representative (BG-11) and contact name', () => {
  const builder = new UblBuilder();

  const representative: TaxRepresentative = {
    name: 'Reprezentant Exemplu SRL',
    vatNumber: 'RO11223344',
    address: { street: 'Str. Exemplu 5', city: 'Cluj-Napoca', postalZone: '400002', county: 'RO-CJ' },
  };

  function buildInput(overrides: Partial<InvoiceInput> = {}): InvoiceInput {
    return {
      ...mockTestData.invoiceData,
      invoiceNumber: 'INV-2026-0002',
      issueDate: '2026-11-12',
      paymentIban: 'RO49AAAA1B31007593840000',
      ...overrides,
    };
  }

  test('omits the tax representative and the contact when neither is given', () => {
    const xml = builder.generateInvoiceXml(buildInput());

    expect(xml).not.toContain('cac:TaxRepresentativeParty');
    expect(xml).not.toContain('<cac:Contact>');
  });

  test('writes the tax representative between the customer party and PaymentMeans', () => {
    const xml = builder.generateInvoiceXml(buildInput({ taxRepresentative: representative }));

    const block = xml.slice(xml.indexOf('<cac:TaxRepresentativeParty>'), xml.indexOf('</cac:TaxRepresentativeParty>'));
    expect(block).toContain('<cbc:Name>Reprezentant Exemplu SRL</cbc:Name>');
    expect(block).toContain('<cbc:CountrySubentity>RO-CJ</cbc:CountrySubentity>');
    expect(block).toContain('<cbc:CompanyID>RO11223344</cbc:CompanyID>');
    // UBL fixes the child order, and allows nothing else.
    expect(block.indexOf('cac:PartyName')).toBeLessThan(block.indexOf('cac:PostalAddress'));
    expect(block.indexOf('cac:PostalAddress')).toBeLessThan(block.indexOf('cac:PartyTaxScheme'));
    expect(block).not.toContain('cac:PartyLegalEntity');

    expect(xml.indexOf('</cac:AccountingCustomerParty>')).toBeLessThan(xml.indexOf('<cac:TaxRepresentativeParty>'));
    expect(xml.indexOf('</cac:TaxRepresentativeParty>')).toBeLessThan(xml.indexOf('<cac:PaymentMeans>'));
  });

  test('writes the contact name first in cac:Contact, and on its own', () => {
    const xml = builder.generateInvoiceXml(
      buildInput({
        supplier: { ...mockTestData.invoiceData.supplier, contactName: 'Ana Exemplu', telephone: '0264000000' },
        customer: { ...mockTestData.invoiceData.customer, contactName: 'Ion Exemplu' },
      })
    );

    const supplier = xml.slice(0, xml.indexOf('</cac:AccountingSupplierParty>'));
    expect(supplier.indexOf('<cbc:Name>Ana Exemplu</cbc:Name>')).toBeGreaterThan(supplier.indexOf('<cac:Contact>'));
    expect(supplier.indexOf('<cbc:Name>Ana Exemplu</cbc:Name>')).toBeLessThan(supplier.indexOf('<cbc:Telephone>'));
    expect(xml).toMatch(/<cac:Contact>\s*<cbc:Name>Ion Exemplu<\/cbc:Name>\s*<\/cac:Contact>/);
  });

  test.each<[string, Partial<InvoiceInput>, RegExp]>([
    ['a missing name', { taxRepresentative: { ...representative, name: ' ' } }, /name is required/],
    ['a missing VAT number', { taxRepresentative: { ...representative, vatNumber: '' } }, /VAT number is required/],
    [
      'a VAT number with no country prefix',
      { taxRepresentative: { ...representative, vatNumber: '11223344' } },
      /country prefix/,
    ],
    [
      'a missing city',
      { taxRepresentative: { ...representative, address: { ...representative.address, city: '' } } },
      /Tax representative city is required/,
    ],
    [
      'a missing county in Romania',
      { taxRepresentative: { ...representative, address: { ...representative.address, county: undefined } } },
      /county is required/,
    ],
    [
      'a supplier that is not a VAT payer',
      { taxRepresentative: representative, isSupplierVatPayer: false },
      /not a VAT payer/,
    ],
  ])('rejects %s', (_label, overrides, message) => {
    expect(() => builder.generateInvoiceXml(buildInput(overrides))).toThrow(AnafValidationError);
    expect(() => builder.generateInvoiceXml(buildInput(overrides))).toThrow(message);
  });

  test('accepts a foreign tax representative address with no county', () => {
    const foreign = {
      ...representative,
      address: { street: 'Musterweg 1', city: 'Wien', postalZone: '1010', countryCode: 'AT' },
    };

    expect(() => builder.generateInvoiceXml(buildInput({ taxRepresentative: foreign }))).not.toThrow();
  });

  test('round trip: the parser reads back what the builder wrote', () => {
    const xml = builder.generateInvoiceXml(
      buildInput({
        note: 'Delegat: Ion Exemplu',
        taxRepresentative: representative,
        supplier: { ...mockTestData.invoiceData.supplier, contactName: 'Ana Exemplu', email: 'ana@exemplu.ro' },
        customer: { ...mockTestData.invoiceData.customer, contactName: 'Ion Exemplu', telephone: '0264111111' },
      })
    );

    expect(parseReceivedInvoice(xml)).toMatchObject({
      notes: ['Delegat: Ion Exemplu'],
      supplierContact: { name: 'Ana Exemplu', telephone: null, email: 'ana@exemplu.ro' },
      customerContact: { name: 'Ion Exemplu', telephone: '0264111111', email: null },
      taxRepresentative: {
        name: 'Reprezentant Exemplu SRL',
        vatCode: 'RO11223344',
        address: {
          street: 'Str. Exemplu 5',
          city: 'Cluj-Napoca',
          county: 'RO-CJ',
          postalZone: '400002',
          countryCode: 'RO',
        },
      },
    });
  });
});
