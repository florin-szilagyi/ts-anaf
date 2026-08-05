import { UblBuilder } from '../src/UblBuilder';
import { InvoiceInput, Party } from '../src/types';
import { mockTestData, testFileUtils, testDataGenerators } from './testUtils';
import { create } from 'xmlbuilder2';

describe('UblBuilder Tests', () => {
  let builder: UblBuilder;

  beforeEach(() => {
    builder = new UblBuilder();
  });

  describe('Constructor and Basic Functionality', () => {
    test('should create UblBuilder instance', () => {
      expect(builder).toBeDefined();
      expect(builder).toBeInstanceOf(UblBuilder);
    });

    test('should have generateInvoiceXml method', () => {
      expect(typeof builder.generateInvoiceXml).toBe('function');
    });
  });

  describe('XML Generation with Valid Data', () => {
    test('should generate valid UBL XML for basic invoice', () => {
      const invoiceData: InvoiceInput = mockTestData.invoiceData;

      const xml = builder.generateInvoiceXml(invoiceData);

      // Check XML structure
      expect(xml).toContain('<?xml version="1.0"');
      expect(xml).toContain('<Invoice');
      expect(xml).toContain('urn:oasis:names:specification:ubl:schema:xsd:Invoice-2');
      expect(xml).toContain('</Invoice>');

      // Check required fields
      expect(xml).toContain(invoiceData.invoiceNumber);
      expect(xml).toContain(invoiceData.supplier.registrationName);
      expect(xml).toContain(invoiceData.customer.registrationName);
      expect(xml).toContain(invoiceData.supplier.vatNumber);
    });

    test('should include invoice metadata', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        invoiceNumber: 'INV-2024-001',
        issueDate: new Date('2024-01-15'),
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('<cbc:ID>INV-2024-001</cbc:ID>');
      expect(xml).toContain('<cbc:IssueDate>2024-01-15</cbc:IssueDate>');
      expect(xml).toContain('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>');
    });

    test('should handle supplier information correctly', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        supplier: {
          registrationName: 'Test Company SRL',
          companyId: 'RO12345678',
          vatNumber: 'RO12345678',
          address: {
            street: 'Str. Testului 123',
            city: 'Bucharest',
            postalZone: '010203',
          },
        },
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('Test Company SRL');
      expect(xml).toContain('RO12345678');
      expect(xml).toContain('Str. Testului 123');
      expect(xml).toContain('Bucharest');
      expect(xml).toContain('010203');
    });

    test('should handle customer information correctly', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        customer: {
          registrationName: 'Customer Company SRL',
          companyId: 'RO87654321',
          address: {
            street: 'Str. Customer 456',
            city: 'Cluj-Napoca',
            postalZone: '400123',
          },
        },
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('Customer Company SRL');
      expect(xml).toContain('RO87654321');
      expect(xml).toContain('Str. Customer 456');
      expect(xml).toContain('Cluj-Napoca');
      expect(xml).toContain('400123');
    });

    test('should handle single invoice line correctly', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: [
          {
            description: 'Test Product',
            quantity: 2,
            unitPrice: 150.5,
            taxPercent: 19,
          },
        ],
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('Test Product');
      expect(xml).toContain('2'); // quantity
      expect(xml).toContain('150.50'); // unit price
      expect(xml).toContain('19'); // tax percent

      // Check calculated values
      expect(xml).toContain('301.00'); // line total (2 * 150.50)
      expect(xml).toContain('57.19'); // tax amount (301 * 0.19)
      expect(xml).toContain('358.19'); // total with tax
    });

    test('should handle multiple invoice lines correctly', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: [
          {
            description: 'Product 1',
            quantity: 1,
            unitPrice: 100,
            taxPercent: 19,
          },
          {
            description: 'Product 2',
            quantity: 2,
            unitPrice: 50,
            taxPercent: 19,
          },
        ],
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('Product 1');
      expect(xml).toContain('Product 2');

      // Check totals (100 + 100 = 200 base, 38 tax, 238 total)
      expect(xml).toContain('200.00'); // total base
      expect(xml).toContain('38.00'); // total tax
      expect(xml).toContain('238.00'); // total with tax
    });

    test('should handle VAT payer status correctly', () => {
      // Test VAT payer
      const vatPayerData: InvoiceInput = {
        ...mockTestData.invoiceData,
        isSupplierVatPayer: true,
      };

      const vatPayerXml = builder.generateInvoiceXml(vatPayerData);
      expect(vatPayerXml).toContain('TaxScheme');
      expect(vatPayerXml).toContain('VAT');

      // Test non-VAT payer
      const nonVatPayerData: InvoiceInput = {
        ...mockTestData.invoiceData,
        isSupplierVatPayer: false,
      };

      const nonVatPayerXml = builder.generateInvoiceXml(nonVatPayerData);
      // Should still contain tax information but structured differently
      expect(nonVatPayerXml).toBeDefined();
    });
  });

  describe('XML Validation and Structure', () => {
    test('should generate well-formed XML', () => {
      const xml = builder.generateInvoiceXml(mockTestData.invoiceData);

      // Basic XML validation
      expect(xml.startsWith('<?xml version="1.0"')).toBe(true);

      // Count opening and closing tags (basic balance check)
      const openingTags = (xml.match(/</g) || []).length;
      const closingTags = (xml.match(/>/g) || []).length;
      expect(openingTags).toBe(closingTags);

      // Check for proper namespace declarations
      expect(xml).toContain('xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"');
      expect(xml).toContain('xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"');
      expect(xml).toContain('xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"');
    });

    test('should generate XML with proper encoding', () => {
      const xml = builder.generateInvoiceXml(mockTestData.invoiceData);

      expect(xml).toContain('encoding="UTF-8"');

      // Test with special characters
      const specialCharsData: InvoiceInput = {
        ...mockTestData.invoiceData,
        supplier: {
          ...mockTestData.invoiceData.supplier,
          registrationName: 'Test & Company SRL "Special" <Chars>',
        },
      };

      const specialXml = builder.generateInvoiceXml(specialCharsData);

      // Should escape special XML characters
      expect(specialXml).toContain('&amp;'); // & becomes &amp;
      expect(specialXml).toContain('&lt;'); // < becomes &lt;
      expect(specialXml).toContain('&gt;'); // > becomes &gt;
      // Note: xmlbuilder2 correctly handles quotes in XML content without escaping to &quot;
      expect(specialXml).toContain('Test &amp; Company SRL "Special" &lt;Chars&gt;');
    });

    test('should maintain consistent element ordering', () => {
      const xml1 = builder.generateInvoiceXml(mockTestData.invoiceData);
      const xml2 = builder.generateInvoiceXml(mockTestData.invoiceData);

      // The XML structure should be consistent between calls
      const extractStructure = (xml: string) => {
        return xml.replace(/>[^<]+</g, '><'); // Remove content, keep only structure
      };

      expect(extractStructure(xml1)).toBe(extractStructure(xml2));
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle empty invoice lines', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: [],
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      // Should still generate valid XML without lines
      expect(xml).toContain('<Invoice');
      expect(xml).toContain('</Invoice>');

      // Should have zero totals
      expect(xml).toContain('<cbc:TaxAmount currencyID="RON">0.00</cbc:TaxAmount>');
      expect(xml).toContain('<cbc:LineExtensionAmount currencyID="RON">0.00</cbc:LineExtensionAmount>');
      expect(xml).toContain('<cbc:PayableAmount currencyID="RON">0.00</cbc:PayableAmount>');
    });

    test('should handle zero-value invoice lines', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: [
          {
            description: 'Free Service',
            quantity: 1,
            unitPrice: 0,
            taxPercent: 19,
          },
        ],
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('Free Service');
      expect(xml).toContain('0.00');
    });

    test('should handle very long descriptions', () => {
      const longDescription = 'A'.repeat(1000);
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: [
          {
            description: longDescription,
            quantity: 1,
            unitPrice: 100,
            taxPercent: 19,
          },
        ],
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain(longDescription);
      expect(xml).toBeDefined();
    });

    test('should handle various tax percentages', () => {
      const taxRates = [0, 5, 9, 19, 24];

      taxRates.forEach((taxRate) => {
        const invoiceData: InvoiceInput = {
          ...mockTestData.invoiceData,
          lines: [
            {
              description: `Item with ${taxRate}% tax`,
              quantity: 1,
              unitPrice: 100,
              taxPercent: taxRate,
            },
          ],
        };

        const xml = builder.generateInvoiceXml(invoiceData);

        expect(xml).toContain(taxRate.toString());
        expect(xml).toBeDefined();
      });
    });

    test('should handle decimal precision correctly', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: [
          {
            description: 'Precision Test',
            quantity: 3,
            unitPrice: 33.333333,
            taxPercent: 19,
          },
        ],
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      // Should round to 2 decimal places
      expect(xml).toContain('33.33'); // unit price
      expect(xml).toContain('99.99'); // line total (3 * 33.33)
    });
  });

  describe('Business Logic Validation', () => {
    test('should calculate line totals correctly', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: [
          {
            description: 'Test Item',
            quantity: 5,
            unitPrice: 20.5,
            taxPercent: 19,
          },
        ],
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      // Line total: 5 * 20.5 = 102.5
      expect(xml).toContain('102.50');

      // Tax amount: 102.5 * 0.19 = 19.475 → 19.48
      expect(xml).toContain('19.48');

      // Total with tax: 102.5 + 19.48 = 121.98
      expect(xml).toContain('121.98');
    });

    test('should handle multiple tax rates correctly', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: [
          {
            description: 'Item with 19% VAT',
            quantity: 1,
            unitPrice: 100,
            taxPercent: 19,
          },
          {
            description: 'Item with 9% VAT',
            quantity: 1,
            unitPrice: 100,
            taxPercent: 9,
          },
        ],
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      // Should contain both tax rates
      expect(xml).toContain('19');
      expect(xml).toContain('9');

      // Total base: 200
      expect(xml).toContain('200.00');

      // Total tax: 19 + 9 = 28
      expect(xml).toContain('28.00');

      // Total with tax: 228
      expect(xml).toContain('228.00');
    });

    test('should generate unique invoice numbers when requested', () => {
      const baseInvoiceData = { ...mockTestData.invoiceData };

      const xml1 = builder.generateInvoiceXml({
        ...baseInvoiceData,
        invoiceNumber: testDataGenerators.randomInvoiceNumber(),
      });

      const xml2 = builder.generateInvoiceXml({
        ...baseInvoiceData,
        invoiceNumber: testDataGenerators.randomInvoiceNumber(),
      });

      expect(xml1).not.toBe(xml2);
    });
  });

  describe('CIUS-RO XML Structure Compliance', () => {
    /**
     * Helper: parse XML string to a JS object for structural assertions
     */
    function parseXml(xml: string): any {
      return create(xml).toObject({ group: true }) as any;
    }

    /**
     * Helper: extract the Invoice root from parsed XML
     */
    function getInvoice(xml: string): any {
      const doc = parseXml(xml);
      return doc.Invoice;
    }

    /**
     * Helper: get element keys in document order from the Invoice root
     */
    function getTopLevelElementOrder(xml: string): string[] {
      // Use regex to extract top-level element names in order
      const matches = [...xml.matchAll(/<(cbc|cac):(\w+)[\s>]/g)];
      const seen = new Set<string>();
      const order: string[] = [];
      for (const m of matches) {
        const name = `${m[1]}:${m[2]}`;
        if (!seen.has(name)) {
          seen.add(name);
          order.push(name);
        }
      }
      return order;
    }

    test('should include UBLVersionID as first element', () => {
      const xml = builder.generateInvoiceXml(mockTestData.invoiceData);
      expect(xml).toContain('<cbc:UBLVersionID>2.1</cbc:UBLVersionID>');

      // Must appear before CustomizationID
      const versionIdx = xml.indexOf('UBLVersionID');
      const customIdx = xml.indexOf('CustomizationID');
      expect(versionIdx).toBeLessThan(customIdx);
    });

    test('should include CustomizationID matching CIUS-RO', () => {
      const xml = builder.generateInvoiceXml(mockTestData.invoiceData);
      expect(xml).toContain(
        'urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1'
      );
    });

    test('should have correct top-level element ordering per UBL 2.1 schema', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        note: 'Test note',
        invoicePeriodEndDate: '2024-06-30',
        paymentIban: 'RO49AAAA1B31007593840000',
      };
      const xml = builder.generateInvoiceXml(invoiceData);
      const order = getTopLevelElementOrder(xml);

      // UBL 2.1 mandates this order for top-level children of <Invoice>
      const expectedOrder = [
        'cbc:UBLVersionID',
        'cbc:CustomizationID',
        'cbc:ID',
        'cbc:IssueDate',
        'cbc:DueDate',
        'cbc:InvoiceTypeCode',
        'cbc:Note',
        'cbc:DocumentCurrencyCode',
        'cac:InvoicePeriod',
        'cac:AccountingSupplierParty',
        'cac:AccountingCustomerParty',
        'cac:PaymentMeans',
        'cac:TaxTotal',
        'cac:LegalMonetaryTotal',
        'cac:InvoiceLine',
      ];

      // Verify each element appears in the correct relative order
      let lastIdx = -1;
      for (const elem of expectedOrder) {
        const idx = order.indexOf(elem);
        expect(idx).toBeGreaterThan(lastIdx);
        lastIdx = idx;
      }
    });

    test('should generate PartyName for both supplier and customer', () => {
      const xml = builder.generateInvoiceXml(mockTestData.invoiceData);

      // Supplier PartyName
      expect(xml).toContain('<cac:PartyName>');
      expect(xml).toContain(`<cbc:Name>${mockTestData.invoiceData.supplier.registrationName}</cbc:Name>`);

      // Customer PartyName
      expect(xml).toContain(`<cbc:Name>${mockTestData.invoiceData.customer.registrationName}</cbc:Name>`);
    });

    test('should have PartyName before PostalAddress in party elements', () => {
      const xml = builder.generateInvoiceXml(mockTestData.invoiceData);

      // For the supplier section
      const supplierStart = xml.indexOf('cac:AccountingSupplierParty');
      const supplierEnd = xml.indexOf('cac:AccountingCustomerParty');
      const supplierSection = xml.substring(supplierStart, supplierEnd);

      const partyNameIdx = supplierSection.indexOf('cac:PartyName');
      const postalAddrIdx = supplierSection.indexOf('cac:PostalAddress');
      expect(partyNameIdx).toBeLessThan(postalAddrIdx);
    });

    test('should have PartyTaxScheme before PartyLegalEntity', () => {
      const xml = builder.generateInvoiceXml(mockTestData.invoiceData);

      // Only for supplier (who has vatNumber)
      const supplierStart = xml.indexOf('cac:AccountingSupplierParty');
      const supplierEnd = xml.indexOf('cac:AccountingCustomerParty');
      const supplierSection = xml.substring(supplierStart, supplierEnd);

      const taxSchemeIdx = supplierSection.indexOf('cac:PartyTaxScheme');
      const legalEntityIdx = supplierSection.indexOf('cac:PartyLegalEntity');
      expect(taxSchemeIdx).toBeGreaterThan(-1);
      expect(taxSchemeIdx).toBeLessThan(legalEntityIdx);
    });

    test('should use PaymentMeansCode 31 (SEPA Credit Transfer)', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        paymentIban: 'RO49AAAA1B31007593840000',
      };
      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('<cbc:PaymentMeansCode>31</cbc:PaymentMeansCode>');
      expect(xml).not.toContain('<cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>');
    });

    test('should include PayeeFinancialAccount with IBAN', () => {
      const iban = 'RO49AAAA1B31007593840000';
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        paymentIban: iban,
      };
      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('<cac:PayeeFinancialAccount>');
      expect(xml).toContain(`<cbc:ID>${iban}</cbc:ID>`);
    });

    test('should omit PaymentMeans when no IBAN is provided', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        paymentIban: undefined,
      };
      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).not.toContain('cac:PaymentMeans');
      expect(xml).not.toContain('PaymentMeansCode');
    });
  });

  describe('Optional CIUS-RO Elements', () => {
    test('should include Note when provided', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        note: 'Factura pentru servicii consultanta luna mai 2024',
      };
      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('<cbc:Note>Factura pentru servicii consultanta luna mai 2024</cbc:Note>');
    });

    test('should omit Note when not provided', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        note: undefined,
      };
      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).not.toContain('<cbc:Note>');
    });

    test('should include InvoicePeriod with EndDate when provided', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        invoicePeriodEndDate: '2024-05-31',
      };
      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('<cac:InvoicePeriod>');
      expect(xml).toContain('<cbc:EndDate>2024-05-31</cbc:EndDate>');
    });

    test('should accept Date object for InvoicePeriod', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        invoicePeriodEndDate: new Date('2024-05-31'),
      };
      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('<cbc:EndDate>2024-05-31</cbc:EndDate>');
    });

    test('should omit InvoicePeriod when not provided', () => {
      const xml = builder.generateInvoiceXml(mockTestData.invoiceData);

      expect(xml).not.toContain('<cac:InvoicePeriod>');
    });

    test('should include Contact with email for supplier', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        supplier: {
          ...mockTestData.invoiceData.supplier,
          email: 'contact@supplier.ro',
        },
      };
      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('<cac:Contact>');
      expect(xml).toContain('<cbc:ElectronicMail>contact@supplier.ro</cbc:ElectronicMail>');
    });

    test('should include Contact with telephone', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        supplier: {
          ...mockTestData.invoiceData.supplier,
          telephone: '+40212345678',
        },
      };
      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('<cbc:Telephone>+40212345678</cbc:Telephone>');
    });

    test('should include Contact with both email and telephone', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        supplier: {
          ...mockTestData.invoiceData.supplier,
          email: 'contact@supplier.ro',
          telephone: '+40212345678',
        },
      };
      const xml = builder.generateInvoiceXml(invoiceData);

      const supplierStart = xml.indexOf('cac:AccountingSupplierParty');
      const supplierEnd = xml.indexOf('cac:AccountingCustomerParty');
      const supplierSection = xml.substring(supplierStart, supplierEnd);

      expect(supplierSection).toContain('<cac:Contact>');
      expect(supplierSection).toContain('<cbc:Telephone>+40212345678</cbc:Telephone>');
      expect(supplierSection).toContain('<cbc:ElectronicMail>contact@supplier.ro</cbc:ElectronicMail>');

      // Telephone should come before ElectronicMail per UBL schema
      const telIdx = supplierSection.indexOf('cbc:Telephone');
      const emailIdx = supplierSection.indexOf('cbc:ElectronicMail');
      expect(telIdx).toBeLessThan(emailIdx);
    });

    test('should omit Contact when neither email nor telephone provided', () => {
      const xml = builder.generateInvoiceXml(mockTestData.invoiceData);

      expect(xml).not.toContain('<cac:Contact>');
    });

    test('should place Contact after PartyLegalEntity', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        supplier: {
          ...mockTestData.invoiceData.supplier,
          email: 'test@test.com',
        },
      };
      const xml = builder.generateInvoiceXml(invoiceData);

      const supplierStart = xml.indexOf('cac:AccountingSupplierParty');
      const supplierEnd = xml.indexOf('cac:AccountingCustomerParty');
      const supplierSection = xml.substring(supplierStart, supplierEnd);

      const legalEntityIdx = supplierSection.indexOf('cac:PartyLegalEntity');
      const contactIdx = supplierSection.indexOf('cac:Contact');
      expect(contactIdx).toBeGreaterThan(legalEntityIdx);
    });

    test('should include PartyIdentification when provided', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        customer: {
          ...mockTestData.invoiceData.customer,
          partyIdentificationId: '123456',
        },
      };
      const xml = builder.generateInvoiceXml(invoiceData);

      const customerStart = xml.indexOf('cac:AccountingCustomerParty');
      const customerEnd = xml.indexOf('cac:PaymentMeans') !== -1
        ? xml.indexOf('cac:PaymentMeans')
        : xml.indexOf('cac:TaxTotal');
      const customerSection = xml.substring(customerStart, customerEnd);

      expect(customerSection).toContain('<cac:PartyIdentification>');
      expect(customerSection).toContain('<cbc:ID>123456</cbc:ID>');
    });

    test('should place PartyIdentification before PartyName', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        customer: {
          ...mockTestData.invoiceData.customer,
          partyIdentificationId: 'CUST-001',
        },
      };
      const xml = builder.generateInvoiceXml(invoiceData);

      const customerStart = xml.indexOf('cac:AccountingCustomerParty');
      const customerSection = xml.substring(customerStart);

      const idIdx = customerSection.indexOf('cac:PartyIdentification');
      const nameIdx = customerSection.indexOf('cac:PartyName');
      expect(idIdx).toBeLessThan(nameIdx);
    });

    test('should omit PartyIdentification when not provided', () => {
      const xml = builder.generateInvoiceXml(mockTestData.invoiceData);

      expect(xml).not.toContain('<cac:PartyIdentification>');
    });
  });

  describe('Full Invoice XML Structural Validation', () => {
    test('should generate XML matching ANAF example structure for a complete invoice', () => {
      const invoiceData: InvoiceInput = {
        invoiceNumber: 'INV-2024-100',
        issueDate: '2024-05-31',
        dueDate: '2024-06-15',
        currency: 'RON',
        note: 'Factura test completa',
        invoicePeriodEndDate: '2024-05-31',
        supplier: {
          registrationName: 'Furnizor Test SRL',
          companyId: 'J40/12345/1998',
          vatNumber: 'RO1234567890',
          address: {
            street: 'Str. Furnizor 1',
            city: 'SECTOR1',
            postalZone: '013329',
            county: 'RO-B',
          },
          email: 'mail@furnizor.com',
        },
        customer: {
          registrationName: 'Client Test SRL',
          companyId: 'J02/321/2010',
          vatNumber: 'RO987456123',
          partyIdentificationId: '123456',
          address: {
            street: 'BD DECEBAL NR 1 ET1',
            city: 'ARAD',
            postalZone: '310001',
            county: 'RO-AR',
          },
        },
        lines: [
          {
            id: 1,
            description: 'Servicii consultanta IT',
            quantity: 10,
            unitCode: 'HUR',
            unitPrice: 150.00,
            taxPercent: 19,
          },
          {
            id: 2,
            description: 'Licenta software anual',
            quantity: 1,
            unitPrice: 2500.00,
            taxPercent: 19,
          },
        ],
        paymentIban: 'RO49AAAA1B31007593840000',
        isSupplierVatPayer: true,
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      // === Header elements ===
      expect(xml).toContain('<cbc:UBLVersionID>2.1</cbc:UBLVersionID>');
      expect(xml).toContain('<cbc:ID>INV-2024-100</cbc:ID>');
      expect(xml).toContain('<cbc:IssueDate>2024-05-31</cbc:IssueDate>');
      expect(xml).toContain('<cbc:DueDate>2024-06-15</cbc:DueDate>');
      expect(xml).toContain('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>');
      expect(xml).toContain('<cbc:Note>Factura test completa</cbc:Note>');
      expect(xml).toContain('<cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>');
      expect(xml).toContain('<cbc:EndDate>2024-05-31</cbc:EndDate>');

      // === Supplier ===
      expect(xml).toContain('<cbc:Name>Furnizor Test SRL</cbc:Name>');
      expect(xml).toContain('<cbc:CompanyID>RO1234567890</cbc:CompanyID>');
      expect(xml).toContain('<cbc:RegistrationName>Furnizor Test SRL</cbc:RegistrationName>');
      expect(xml).toContain('<cbc:ElectronicMail>mail@furnizor.com</cbc:ElectronicMail>');
      expect(xml).toContain('<cbc:CountrySubentity>RO-B</cbc:CountrySubentity>');

      // === Customer ===
      expect(xml).toContain('<cbc:Name>Client Test SRL</cbc:Name>');
      expect(xml).toContain('<cbc:RegistrationName>Client Test SRL</cbc:RegistrationName>');

      // === Payment ===
      expect(xml).toContain('<cbc:PaymentMeansCode>31</cbc:PaymentMeansCode>');
      expect(xml).toContain('RO49AAAA1B31007593840000');

      // === Tax calculation ===
      // Line 1: 10 * 150 = 1500, tax = 285
      // Line 2: 1 * 2500 = 2500, tax = 475
      // Total taxable = 4000, total tax = 760, grand total = 4760
      expect(xml).toContain('<cbc:TaxableAmount currencyID="RON">4000.00</cbc:TaxableAmount>');
      expect(xml).toContain('<cbc:LineExtensionAmount currencyID="RON">4000.00</cbc:LineExtensionAmount>');
      expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="RON">4000.00</cbc:TaxExclusiveAmount>');
      expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="RON">4760.00</cbc:TaxInclusiveAmount>');
      expect(xml).toContain('<cbc:PayableAmount currencyID="RON">4760.00</cbc:PayableAmount>');

      // === Line items ===
      expect(xml).toContain('<cbc:Description>Servicii consultanta IT</cbc:Description>');
      expect(xml).toContain('<cbc:Description>Licenta software anual</cbc:Description>');
      expect(xml).toContain('unitCode="HUR"');

      // === Tax category ===
      expect(xml).toContain('<cbc:ID>S</cbc:ID>'); // Standard rated
    });

    test('should handle non-VAT payer with category O and exemption reason', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        isSupplierVatPayer: false,
        supplier: {
          registrationName: 'Persoana Fizica Autorizata',
          companyId: 'F08/123/2020',
          // No vatNumber
          address: {
            street: 'Str. PFA 1',
            city: 'Timisoara',
            postalZone: '300001',
          },
        },
        lines: [
          {
            description: 'Servicii freelance',
            quantity: 1,
            unitPrice: 5000,
            taxPercent: 0,
          },
        ],
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      // Tax category O = not subject to VAT
      expect(xml).toContain('<cbc:ID>O</cbc:ID>');
      expect(xml).toContain('<cbc:TaxExemptionReasonCode>VATEX-EU-O</cbc:TaxExemptionReasonCode>');

      // No PartyTaxScheme since no vatNumber
      const supplierStart = xml.indexOf('cac:AccountingSupplierParty');
      const supplierEnd = xml.indexOf('cac:AccountingCustomerParty');
      const supplierSection = xml.substring(supplierStart, supplierEnd);
      expect(supplierSection).not.toContain('cac:PartyTaxScheme');

      // Tax amount should be 0
      expect(xml).toContain('<cbc:TaxAmount currencyID="RON">0.00</cbc:TaxAmount>');
      expect(xml).toContain('<cbc:PayableAmount currencyID="RON">5000.00</cbc:PayableAmount>');
    });

    test('should handle mixed tax rates with correct grouping', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: [
          { description: 'Product 19%', quantity: 2, unitPrice: 100, taxPercent: 19 },
          { description: 'Food 9%', quantity: 3, unitPrice: 50, taxPercent: 9 },
          { description: 'Another 19%', quantity: 1, unitPrice: 200, taxPercent: 19 },
          { description: 'Zero rated', quantity: 1, unitPrice: 100, taxPercent: 0 },
        ],
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      // 19% group: (2*100) + (1*200) = 400, tax = 76
      // 9% group: 3*50 = 150, tax = 13.50
      // 0% group: 100, tax = 0
      // Total: 650 + 89.50 = 739.50
      expect(xml).toContain('<cbc:LineExtensionAmount currencyID="RON">650.00</cbc:LineExtensionAmount>');

      // Count TaxSubtotal elements — should be 3 (for 19%, 9%, 0%)
      const taxSubtotalCount = (xml.match(/<cac:TaxSubtotal>/g) || []).length;
      expect(taxSubtotalCount).toBe(3);

      // Verify tax categories present
      expect(xml).toContain('<cbc:Percent>19.00</cbc:Percent>');
      expect(xml).toContain('<cbc:Percent>9.00</cbc:Percent>');
      expect(xml).toContain('<cbc:Percent>0.00</cbc:Percent>');
    });

    test('should generate two InvoiceLine elements for two line items', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: [
          { id: '1', description: 'Item A', quantity: 1, unitPrice: 100, taxPercent: 19 },
          { id: '2', description: 'Item B', quantity: 2, unitPrice: 50, taxPercent: 19 },
        ],
      };
      const xml = builder.generateInvoiceXml(invoiceData);

      const lineCount = (xml.match(/<cac:InvoiceLine>/g) || []).length;
      expect(lineCount).toBe(2);

      // Each line should have the correct structure
      expect(xml).toContain('<cbc:InvoicedQuantity');
      expect(xml).toContain('<cbc:LineExtensionAmount');
      expect(xml).toContain('<cac:Item>');
      expect(xml).toContain('<cac:ClassifiedTaxCategory>');
      expect(xml).toContain('<cac:Price>');
      expect(xml).toContain('<cbc:PriceAmount');
    });

    test('should produce valid XML that can be parsed back', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        note: 'Test round-trip',
        paymentIban: 'RO49AAAA1B31007593840000',
        invoicePeriodEndDate: '2024-12-31',
        supplier: {
          ...mockTestData.invoiceData.supplier,
          email: 'test@test.ro',
          telephone: '+40700000000',
        },
        customer: {
          ...mockTestData.invoiceData.customer,
          partyIdentificationId: 'EXT-REF-001',
        },
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      // Should not throw when parsed
      expect(() => create(xml)).not.toThrow();

      // Parse and verify key elements exist
      const doc = create(xml).toObject({ group: true }) as any;
      const invoice = doc.Invoice;
      expect(invoice).toBeDefined();
    });

    test('should emit TaxCurrencyCode RON when currency is not RON (BR-RO-030)', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        currency: 'EUR',
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>');
      expect(xml).toContain('currencyID="EUR"');
      // BR-RO-030: TaxCurrencyCode must be RON when invoice currency is not RON
      expect(xml).toContain('<cbc:TaxCurrencyCode>RON</cbc:TaxCurrencyCode>');
      // No second TaxTotal in RON because taxCurrencyTaxAmount is not provided
      expect(xml).not.toContain('currencyID="RON"');
    });

    test('should emit second TaxTotal in RON when taxCurrencyTaxAmount is provided (BR-53)', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        currency: 'EUR',
        taxCurrencyTaxAmount: 530.25,
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('<cbc:TaxCurrencyCode>RON</cbc:TaxCurrencyCode>');
      // BT-111: second TaxTotal with RON currencyID
      expect(xml).toContain('<cbc:TaxAmount currencyID="RON">530.25</cbc:TaxAmount>');
    });

    test('should not emit TaxCurrencyCode when currency is RON', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        currency: 'RON',
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).not.toContain('TaxCurrencyCode');
    });

    test('should default dueDate to issueDate when not provided', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        issueDate: '2024-03-15',
        dueDate: undefined,
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('<cbc:IssueDate>2024-03-15</cbc:IssueDate>');
      expect(xml).toContain('<cbc:DueDate>2024-03-15</cbc:DueDate>');
    });

    test('should auto-number line IDs when not provided', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: [
          { description: 'A', quantity: 1, unitPrice: 10 },
          { description: 'B', quantity: 1, unitPrice: 20 },
          { description: 'C', quantity: 1, unitPrice: 30 },
        ],
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      // Lines should be auto-numbered 1, 2, 3
      const lineIds = [...xml.matchAll(/<cac:InvoiceLine>\s*<cbc:ID>(\d+)<\/cbc:ID>/g)].map(m => m[1]);
      expect(lineIds).toEqual(['1', '2', '3']);
    });
  });

  describe('CIUS-RO BR-O rules (non-VAT supplier, category O)', () => {
    /**
     * Helpers — extract a focused slice of the XML so assertions don't false-positive on
     * matches in other parts of the document.
     */
    function extractCustomerSection(xml: string): string {
      const start = xml.indexOf('cac:AccountingCustomerParty');
      // The next top-level element after the customer party is either PaymentMeans or TaxTotal.
      const stops = ['cac:PaymentMeans', 'cac:TaxTotal'];
      let end = xml.length;
      for (const stop of stops) {
        const idx = xml.indexOf(stop, start);
        if (idx > -1 && idx < end) end = idx;
      }
      return xml.substring(start, end);
    }
    function extractTaxSubtotalSection(xml: string): string {
      const start = xml.indexOf('<cac:TaxSubtotal');
      const end = xml.indexOf('</cac:TaxSubtotal>', start);
      return xml.substring(start, end);
    }
    function extractClassifiedTaxCategorySection(xml: string): string {
      const start = xml.indexOf('<cac:ClassifiedTaxCategory');
      const end = xml.indexOf('</cac:ClassifiedTaxCategory>', start);
      return xml.substring(start, end);
    }

    test('non-VAT supplier with VAT-registered customer omits Percent and customer PartyTaxScheme', () => {
      const invoiceData: InvoiceInput = {
        invoiceNumber: 'PPAgnt-001',
        issueDate: '2026-05-08',
        currency: 'RON',
        supplier: {
          registrationName: 'PP AUTO SRL',
          companyId: '30498862',
          // No vatNumber: non-VAT supplier
          address: {
            street: 'Str. PFA 1',
            city: 'Cluj-Napoca',
            postalZone: '400001',
            county: 'RO-CJ',
          },
        },
        customer: {
          registrationName: 'CARCENTRIC S.R.L.',
          companyId: '28914903',
          // VAT-registered customer — the SDK must still drop PartyTaxScheme because
          // BR-O-02 forbids any party VAT id when all lines are category 'O'.
          vatNumber: 'RO28914903',
          address: {
            street: 'STR SEMICERCULUI NR 12',
            city: 'SECTOR1',
            postalZone: '010101',
            county: 'RO-B',
          },
        },
        lines: [
          {
            description: 'Servicii conform deviz',
            quantity: 1,
            unitPrice: 1425,
            taxPercent: 0,
          },
        ],
        isSupplierVatPayer: false,
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      // Category 'O' is set for both the tax subtotal and the line classification.
      const taxSubtotal = extractTaxSubtotalSection(xml);
      const classifiedTaxCategory = extractClassifiedTaxCategorySection(xml);
      expect(taxSubtotal).toContain('<cbc:ID>O</cbc:ID>');
      expect(classifiedTaxCategory).toContain('<cbc:ID>O</cbc:ID>');

      // BR-O-05: no <cbc:Percent> inside either category 'O' block.
      expect(taxSubtotal).not.toContain('<cbc:Percent>');
      expect(classifiedTaxCategory).not.toContain('<cbc:Percent>');

      // BR-O-02: no PartyTaxScheme on either supplier or customer.
      const customerSection = extractCustomerSection(xml);
      expect(customerSection).not.toContain('cac:PartyTaxScheme');
      const supplierStart = xml.indexOf('cac:AccountingSupplierParty');
      const supplierEnd = xml.indexOf('cac:AccountingCustomerParty');
      const supplierSection = xml.substring(supplierStart, supplierEnd);
      expect(supplierSection).not.toContain('cac:PartyTaxScheme');

      // The exemption reason must still be emitted for category 'O'.
      expect(taxSubtotal).toContain('<cbc:TaxExemptionReasonCode>VATEX-EU-O</cbc:TaxExemptionReasonCode>');
    });

    test('VAT-payer supplier still emits Percent and customer PartyTaxScheme (regression)', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        isSupplierVatPayer: true,
        supplier: {
          ...mockTestData.invoiceData.supplier,
          vatNumber: 'RO12345678',
        },
        customer: {
          ...mockTestData.invoiceData.customer,
          vatNumber: 'RO87654321',
        },
        lines: [
          { description: 'Standard rated', quantity: 1, unitPrice: 100, taxPercent: 19 },
          { description: 'Zero rated', quantity: 1, unitPrice: 50, taxPercent: 0 },
        ],
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      // Customer PartyTaxScheme must still be present for VAT-registered buyers.
      const customerSection = extractCustomerSection(xml);
      expect(customerSection).toContain('cac:PartyTaxScheme');
      expect(customerSection).toContain('<cbc:CompanyID>RO87654321</cbc:CompanyID>');

      // Supplier PartyTaxScheme must still be present.
      const supplierStart = xml.indexOf('cac:AccountingSupplierParty');
      const supplierEnd = xml.indexOf('cac:AccountingCustomerParty');
      const supplierSection = xml.substring(supplierStart, supplierEnd);
      expect(supplierSection).toContain('cac:PartyTaxScheme');

      // Percent must still be emitted on category 'S' and 'Z' lines/subtotals.
      expect(xml).toContain('<cbc:Percent>19.00</cbc:Percent>');
      expect(xml).toContain('<cbc:Percent>0.00</cbc:Percent>');
      // Sanity: there are no 'O' categories in this invoice.
      expect(xml).not.toContain('<cbc:ID>O</cbc:ID>');
    });

    test('non-VAT supplier with non-VAT customer (no vatNumber) still drops both PartyTaxScheme blocks', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        isSupplierVatPayer: false,
        supplier: {
          registrationName: 'PFA Supplier',
          companyId: 'F40/123/2020',
          // no vatNumber
          address: {
            street: 'Str. PFA 1',
            city: 'Cluj-Napoca',
            postalZone: '400001',
          },
        },
        customer: {
          registrationName: 'Buyer SRL',
          companyId: '99999999',
          // no vatNumber
          address: {
            street: 'Str. Buyer 2',
            city: 'Iasi',
            postalZone: '700001',
          },
        },
        lines: [{ description: 'Service', quantity: 1, unitPrice: 100, taxPercent: 0 }],
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).not.toContain('cac:PartyTaxScheme');
      const taxSubtotal = extractTaxSubtotalSection(xml);
      const classifiedTaxCategory = extractClassifiedTaxCategorySection(xml);
      expect(taxSubtotal).toContain('<cbc:ID>O</cbc:ID>');
      expect(classifiedTaxCategory).toContain('<cbc:ID>O</cbc:ID>');
      expect(taxSubtotal).not.toContain('<cbc:Percent>');
      expect(classifiedTaxCategory).not.toContain('<cbc:Percent>');
    });
  });

  describe('PaymentMeans + PrepaidAmount (cash/card payments)', () => {
    /**
     * The mockTestData fixture has a single line: quantity 1, unit price 100, tax 19% →
     * line extension 100.00, tax 19.00, grand total 119.00. Reuse those numbers across
     * the assertions below.
     */
    const GRAND_TOTAL = 119.0;

    test('emits PaymentMeansCode 10 (cash) with no PayeeFinancialAccount when paid in cash', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        paymentMeansCode: '10',
        prepaidAmount: GRAND_TOTAL,
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('<cac:PaymentMeans>');
      expect(xml).toContain('<cbc:PaymentMeansCode>10</cbc:PaymentMeansCode>');
      expect(xml).not.toContain('<cac:PayeeFinancialAccount>');
      // Fully paid → PayableAmount = 0.00, PrepaidAmount = grand total.
      expect(xml).toContain(`<cbc:PrepaidAmount currencyID="RON">${GRAND_TOTAL.toFixed(2)}</cbc:PrepaidAmount>`);
      expect(xml).toContain('<cbc:PayableAmount currencyID="RON">0.00</cbc:PayableAmount>');
    });

    test('emits PaymentMeansCode 48 (card) with no PayeeFinancialAccount when paid by card', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        paymentMeansCode: '48',
        prepaidAmount: GRAND_TOTAL,
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('<cbc:PaymentMeansCode>48</cbc:PaymentMeansCode>');
      expect(xml).not.toContain('<cac:PayeeFinancialAccount>');
      expect(xml).toContain('<cbc:PayableAmount currencyID="RON">0.00</cbc:PayableAmount>');
    });

    test('handles partial prepayment (PayableAmount = grandTotal − prepaidAmount)', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: [{ description: 'Service', quantity: 1, unitPrice: 100, taxPercent: 0 }],
        prepaidAmount: 50,
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      // Grand total 100, prepaid 50 → payable 50.
      expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="RON">100.00</cbc:TaxInclusiveAmount>');
      expect(xml).toContain('<cbc:PrepaidAmount currencyID="RON">50.00</cbc:PrepaidAmount>');
      expect(xml).toContain('<cbc:PayableAmount currencyID="RON">50.00</cbc:PayableAmount>');
    });

    test('places PrepaidAmount immediately before PayableAmount inside LegalMonetaryTotal', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        paymentMeansCode: '10',
        prepaidAmount: GRAND_TOTAL,
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      const start = xml.indexOf('<cac:LegalMonetaryTotal>');
      const end = xml.indexOf('</cac:LegalMonetaryTotal>', start);
      const section = xml.substring(start, end);

      const prepaidIdx = section.indexOf('cbc:PrepaidAmount');
      const payableIdx = section.indexOf('cbc:PayableAmount');
      const taxInclusiveIdx = section.indexOf('cbc:TaxInclusiveAmount');

      expect(prepaidIdx).toBeGreaterThan(taxInclusiveIdx);
      expect(payableIdx).toBeGreaterThan(prepaidIdx);
    });

    test('emits PaymentMeans even when no IBAN is provided (cash-only invoice)', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        paymentMeansCode: '10',
        // No paymentIban — but PaymentMeans should still appear because of the code.
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('<cac:PaymentMeans>');
      expect(xml).toContain('<cbc:PaymentMeansCode>10</cbc:PaymentMeansCode>');
      expect(xml).not.toContain('<cac:PayeeFinancialAccount>');
    });

    test('backwards compat: paymentIban alone still emits code 31 + IBAN and no PrepaidAmount', () => {
      const iban = 'RO49AAAA1B31007593840000';
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        paymentIban: iban,
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('<cbc:PaymentMeansCode>31</cbc:PaymentMeansCode>');
      expect(xml).toContain('<cac:PayeeFinancialAccount>');
      expect(xml).toContain(`<cbc:ID>${iban}</cbc:ID>`);
      // No prepayment → no PrepaidAmount, PayableAmount = grand total.
      expect(xml).not.toContain('cbc:PrepaidAmount');
      expect(xml).toContain(`<cbc:PayableAmount currencyID="RON">${GRAND_TOTAL.toFixed(2)}</cbc:PayableAmount>`);
    });

    test('emits PaymentMeansCode override (e.g. 30 credit transfer) together with IBAN when both are set', () => {
      const iban = 'RO49AAAA1B31007593840000';
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        paymentMeansCode: '30',
        paymentIban: iban,
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('<cbc:PaymentMeansCode>30</cbc:PaymentMeansCode>');
      expect(xml).toContain('<cac:PayeeFinancialAccount>');
      expect(xml).toContain(`<cbc:ID>${iban}</cbc:ID>`);
    });

    test('throws AnafValidationError when prepaidAmount exceeds the grand total', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: [{ description: 'Item', quantity: 1, unitPrice: 100, taxPercent: 0 }],
        prepaidAmount: 200, // grand total is 100
      };

      // UblBuilder wraps the builder error in AnafValidationError — assert on
      // the wrapping class + the inner message text.
      expect(() => builder.generateInvoiceXml(invoiceData)).toThrow(/Prepaid amount/);
    });

    test('throws AnafValidationError when prepaidAmount is negative', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        prepaidAmount: -1,
      };

      expect(() => builder.generateInvoiceXml(invoiceData)).toThrow(/Prepaid amount/);
    });

    test('accepts prepaidAmount === grandTotal within rounding tolerance', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        // Force a non-trivial total by overriding the line. Line: 1 * 33.333 * 1.19 ≈ 39.66.
        lines: [{ description: 'Service', quantity: 1, unitPrice: 33.33, taxPercent: 19 }],
        prepaidAmount: 39.66,
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="RON">39.66</cbc:TaxInclusiveAmount>');
      expect(xml).toContain('<cbc:PrepaidAmount currencyID="RON">39.66</cbc:PrepaidAmount>');
      expect(xml).toContain('<cbc:PayableAmount currencyID="RON">0.00</cbc:PayableAmount>');
    });

    test('default behaviour (no payment fields) is unchanged: no PaymentMeans, PayableAmount = grand total', () => {
      const xml = builder.generateInvoiceXml(mockTestData.invoiceData);

      expect(xml).not.toContain('cac:PaymentMeans');
      expect(xml).not.toContain('cbc:PrepaidAmount');
      expect(xml).toContain(`<cbc:PayableAmount currencyID="RON">${GRAND_TOTAL.toFixed(2)}</cbc:PayableAmount>`);
    });
  });

  describe('Document-level AllowanceCharge (vouchers / discounts / surcharges)', () => {
    /**
     * Baseline used in this block: a single 0%-rated line of 50 RON (the canonical
     * voucher use-case from the kiosk consumer). The customer pays 5 RON after a
     * 45 RON voucher is applied at document level.
     */
    const baseVoucherInvoice = (): InvoiceInput => ({
      ...mockTestData.invoiceData,
      lines: [{ description: 'Wash service', quantity: 1, unitPrice: 50, taxPercent: 0 }],
    });

    test('omitting documentAllowanceCharges keeps XML byte-identical to v1.3.1 baseline', () => {
      const without = builder.generateInvoiceXml(mockTestData.invoiceData);
      const withEmpty = builder.generateInvoiceXml({
        ...mockTestData.invoiceData,
        documentAllowanceCharges: [],
      });

      // Empty array == omitted: no AllowanceCharge block, no Allowance/Charge totals,
      // identical LegalMonetaryTotal numbers.
      expect(without).not.toContain('cac:AllowanceCharge');
      expect(withEmpty).not.toContain('cac:AllowanceCharge');
      expect(without).not.toContain('cbc:AllowanceTotalAmount');
      expect(withEmpty).not.toContain('cbc:AllowanceTotalAmount');
      expect(without).toBe(withEmpty);
    });

    test('voucher discount: 50 RON line, 45 RON allowance, prepaid 5 → PayableAmount 0', () => {
      const xml = builder.generateInvoiceXml({
        ...baseVoucherInvoice(),
        documentAllowanceCharges: [
          { chargeIndicator: false, amount: 45, reason: 'Voucher' },
        ],
        prepaidAmount: 5,
      });

      // The AllowanceCharge block itself.
      expect(xml).toContain('<cac:AllowanceCharge>');
      expect(xml).toContain('<cbc:ChargeIndicator>false</cbc:ChargeIndicator>');
      expect(xml).toContain('<cbc:AllowanceChargeReasonCode>95</cbc:AllowanceChargeReasonCode>');
      expect(xml).toContain('<cbc:AllowanceChargeReason>Voucher</cbc:AllowanceChargeReason>');
      expect(xml).toContain('<cbc:Amount currencyID="RON">45.00</cbc:Amount>');
      // Tax category inherited from the single 0%-rated line group ('Z').
      // (LegalMonetaryTotal totals are asserted below; here we just sanity-check
      // the AllowanceCharge's nested TaxCategory id.)
      const acStart = xml.indexOf('<cac:AllowanceCharge>');
      const acEnd = xml.indexOf('</cac:AllowanceCharge>');
      const acBlock = xml.substring(acStart, acEnd);
      expect(acBlock).toContain('<cbc:ID>Z</cbc:ID>');
      expect(acBlock).toContain('<cbc:Percent>0.00</cbc:Percent>');

      // LegalMonetaryTotal: LineExtension 50, Allowance 45, TaxExclusive 5, TaxInclusive 5,
      // Prepaid 5, Payable 0.
      expect(xml).toContain('<cbc:LineExtensionAmount currencyID="RON">50.00</cbc:LineExtensionAmount>');
      expect(xml).toContain('<cbc:AllowanceTotalAmount currencyID="RON">45.00</cbc:AllowanceTotalAmount>');
      expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="RON">5.00</cbc:TaxExclusiveAmount>');
      expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="RON">5.00</cbc:TaxInclusiveAmount>');
      expect(xml).toContain('<cbc:PrepaidAmount currencyID="RON">5.00</cbc:PrepaidAmount>');
      expect(xml).toContain('<cbc:PayableAmount currencyID="RON">0.00</cbc:PayableAmount>');

      // TaxSubtotal for category Z is decremented by the allowance: 50 − 45 = 5.
      const taxSubtotalStart = xml.indexOf('<cac:TaxSubtotal>');
      const taxSubtotalEnd = xml.indexOf('</cac:TaxSubtotal>') + '</cac:TaxSubtotal>'.length;
      const taxSubtotal = xml.substring(taxSubtotalStart, taxSubtotalEnd);
      expect(taxSubtotal).toContain('<cbc:TaxableAmount currencyID="RON">5.00</cbc:TaxableAmount>');
      expect(taxSubtotal).toContain('<cbc:TaxAmount currencyID="RON">0.00</cbc:TaxAmount>');
      expect(taxSubtotal).toContain('<cbc:ID>Z</cbc:ID>');
    });

    test('explicit taxCategoryId=Z and taxPercent=0 emit the expected AllowanceCharge XML shape', () => {
      const xml = builder.generateInvoiceXml({
        ...baseVoucherInvoice(),
        documentAllowanceCharges: [
          {
            chargeIndicator: false,
            amount: 10,
            reason: 'Loyalty',
            taxCategoryId: 'Z',
            taxPercent: 0,
          },
        ],
      });

      // Verify TaxScheme is nested under TaxCategory.
      const acStart = xml.indexOf('<cac:AllowanceCharge>');
      const acEnd = xml.indexOf('</cac:AllowanceCharge>');
      const block = xml.substring(acStart, acEnd);
      expect(block).toContain('<cac:TaxCategory>');
      expect(block).toContain('<cbc:ID>Z</cbc:ID>');
      expect(block).toContain('<cbc:Percent>0.00</cbc:Percent>');
      expect(block).toContain('<cac:TaxScheme>');
      expect(block).toContain('<cbc:ID>VAT</cbc:ID>');
    });

    test('charge (chargeIndicator=true) increases TaxExclusiveAmount and defaults to ZZZ reason code', () => {
      const xml = builder.generateInvoiceXml({
        ...mockTestData.invoiceData,
        // Single 19%-rated 100 RON line → TaxExclusive 100, TaxInclusive 119.
        // Add 10 RON shipping charge → TaxExclusive 110, Tax 20.90, TaxInclusive 130.90.
        documentAllowanceCharges: [{ chargeIndicator: true, amount: 10, reason: 'Shipping' }],
      });

      expect(xml).toContain('<cbc:ChargeIndicator>true</cbc:ChargeIndicator>');
      expect(xml).toContain('<cbc:AllowanceChargeReasonCode>ZZZ</cbc:AllowanceChargeReasonCode>');
      expect(xml).toContain('<cbc:AllowanceChargeReason>Shipping</cbc:AllowanceChargeReason>');
      expect(xml).toContain('<cbc:Amount currencyID="RON">10.00</cbc:Amount>');
      expect(xml).toContain('<cbc:LineExtensionAmount currencyID="RON">100.00</cbc:LineExtensionAmount>');
      expect(xml).toContain('<cbc:ChargeTotalAmount currencyID="RON">10.00</cbc:ChargeTotalAmount>');
      expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="RON">110.00</cbc:TaxExclusiveAmount>');
      // 110 * 19% = 20.90 → TaxInclusive 130.90.
      expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="RON">130.90</cbc:TaxInclusiveAmount>');
      expect(xml).not.toContain('cbc:AllowanceTotalAmount');
    });

    test('allowance inherits tax category from a single-category lines array', () => {
      const xml = builder.generateInvoiceXml({
        ...mockTestData.invoiceData,
        // Single 19%-rated line → group is { S, 19% }.
        documentAllowanceCharges: [{ chargeIndicator: false, amount: 20, reason: 'Promo' }],
      });

      const acStart = xml.indexOf('<cac:AllowanceCharge>');
      const acEnd = xml.indexOf('</cac:AllowanceCharge>');
      const block = xml.substring(acStart, acEnd);
      expect(block).toContain('<cbc:ID>S</cbc:ID>');
      expect(block).toContain('<cbc:Percent>19.00</cbc:Percent>');

      // Math: line 100 @ 19% → LineExt 100. Allowance 20 → TaxExclusive 80,
      // Tax 80 * 19% = 15.20, TaxInclusive 95.20.
      expect(xml).toContain('<cbc:LineExtensionAmount currencyID="RON">100.00</cbc:LineExtensionAmount>');
      expect(xml).toContain('<cbc:AllowanceTotalAmount currencyID="RON">20.00</cbc:AllowanceTotalAmount>');
      expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="RON">80.00</cbc:TaxExclusiveAmount>');
      expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="RON">95.20</cbc:TaxInclusiveAmount>');
    });

    test('mixed-category lines + no explicit taxCategoryId throws AnafValidationError', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: [
          { description: 'Standard rated', quantity: 1, unitPrice: 100, taxPercent: 19 },
          { description: 'Zero rated', quantity: 1, unitPrice: 50, taxPercent: 0 },
        ],
        documentAllowanceCharges: [{ chargeIndicator: false, amount: 10, reason: 'Promo' }],
      };

      expect(() => builder.generateInvoiceXml(invoiceData)).toThrow(/mixed tax categories/);
    });

    test('amount <= 0 throws AnafValidationError', () => {
      expect(() =>
        builder.generateInvoiceXml({
          ...baseVoucherInvoice(),
          documentAllowanceCharges: [{ chargeIndicator: false, amount: 0, reason: 'Voucher' }],
        })
      ).toThrow(/positive number/);

      expect(() =>
        builder.generateInvoiceXml({
          ...baseVoucherInvoice(),
          documentAllowanceCharges: [{ chargeIndicator: false, amount: -5, reason: 'Voucher' }],
        })
      ).toThrow(/positive number/);
    });

    test('empty reason string throws AnafValidationError', () => {
      expect(() =>
        builder.generateInvoiceXml({
          ...baseVoucherInvoice(),
          documentAllowanceCharges: [{ chargeIndicator: false, amount: 10, reason: '   ' }],
        })
      ).toThrow(/reason is required/);
    });

    test('AllowanceCharge is emitted after PaymentMeans and before TaxTotal (UBL 2.1 ordering)', () => {
      const xml = builder.generateInvoiceXml({
        ...baseVoucherInvoice(),
        paymentMeansCode: '10',
        prepaidAmount: 5,
        documentAllowanceCharges: [{ chargeIndicator: false, amount: 45, reason: 'Voucher' }],
      });

      const paymentMeansIdx = xml.indexOf('<cac:PaymentMeans>');
      const allowanceIdx = xml.indexOf('<cac:AllowanceCharge>');
      const taxTotalIdx = xml.indexOf('<cac:TaxTotal>');

      expect(paymentMeansIdx).toBeGreaterThan(0);
      expect(allowanceIdx).toBeGreaterThan(paymentMeansIdx);
      expect(taxTotalIdx).toBeGreaterThan(allowanceIdx);
    });

    test('LegalMonetaryTotal children appear in UBL 2.1 schema order', () => {
      const xml = builder.generateInvoiceXml({
        ...baseVoucherInvoice(),
        documentAllowanceCharges: [{ chargeIndicator: false, amount: 45, reason: 'Voucher' }],
        prepaidAmount: 5,
      });

      const start = xml.indexOf('<cac:LegalMonetaryTotal>');
      const end = xml.indexOf('</cac:LegalMonetaryTotal>', start);
      const section = xml.substring(start, end);

      const lineExtIdx = section.indexOf('cbc:LineExtensionAmount');
      const taxExclIdx = section.indexOf('cbc:TaxExclusiveAmount');
      const taxInclIdx = section.indexOf('cbc:TaxInclusiveAmount');
      const allowanceIdx = section.indexOf('cbc:AllowanceTotalAmount');
      const prepaidIdx = section.indexOf('cbc:PrepaidAmount');
      const payableIdx = section.indexOf('cbc:PayableAmount');

      expect(lineExtIdx).toBeGreaterThan(-1);
      expect(taxExclIdx).toBeGreaterThan(lineExtIdx);
      expect(taxInclIdx).toBeGreaterThan(taxExclIdx);
      expect(allowanceIdx).toBeGreaterThan(taxInclIdx);
      expect(prepaidIdx).toBeGreaterThan(allowanceIdx);
      expect(payableIdx).toBeGreaterThan(prepaidIdx);
    });

    test('multiple allowances accumulate into AllowanceTotalAmount', () => {
      const xml = builder.generateInvoiceXml({
        ...baseVoucherInvoice(),
        documentAllowanceCharges: [
          { chargeIndicator: false, amount: 5, reason: 'Voucher A' },
          { chargeIndicator: false, amount: 10, reason: 'Voucher B' },
        ],
      });

      // 50 line - 15 total allowances = 35 TaxExclusive (0% VAT → 35 TaxInclusive too).
      expect(xml).toContain('<cbc:AllowanceTotalAmount currencyID="RON">15.00</cbc:AllowanceTotalAmount>');
      expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="RON">35.00</cbc:TaxExclusiveAmount>');
      expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="RON">35.00</cbc:TaxInclusiveAmount>');

      // Both AllowanceCharge blocks emitted.
      const acCount = (xml.match(/<cac:AllowanceCharge>/g) ?? []).length;
      expect(acCount).toBe(2);
    });

    test('custom reasonCode overrides the default', () => {
      const xml = builder.generateInvoiceXml({
        ...baseVoucherInvoice(),
        documentAllowanceCharges: [
          { chargeIndicator: false, amount: 5, reason: 'Marketing promo', reasonCode: '102' },
        ],
      });

      expect(xml).toContain('<cbc:AllowanceChargeReasonCode>102</cbc:AllowanceChargeReasonCode>');
    });

    test('non-VAT supplier (category O): allowance is coerced to O and has no Percent', () => {
      const nonVatSupplier: Party = {
        ...mockTestData.invoiceData.supplier,
        vatNumber: undefined,
      };

      const xml = builder.generateInvoiceXml({
        ...mockTestData.invoiceData,
        supplier: nonVatSupplier,
        isSupplierVatPayer: false,
        lines: [{ description: 'Service', quantity: 1, unitPrice: 100, taxPercent: 0 }],
        documentAllowanceCharges: [{ chargeIndicator: false, amount: 30, reason: 'Discount' }],
      });

      const acStart = xml.indexOf('<cac:AllowanceCharge>');
      const acEnd = xml.indexOf('</cac:AllowanceCharge>');
      const block = xml.substring(acStart, acEnd);
      expect(block).toContain('<cbc:ID>O</cbc:ID>');
      // BR-O-05: cbc:Percent must NOT appear for category O.
      expect(block).not.toContain('<cbc:Percent>');
      // UBL-CR-480: the exemption reason must NOT appear inside the AllowanceCharge
      // TaxCategory (it lives on the TaxSubtotal instead — covered by the dedicated
      // UBL-CR-480 regression test below).
      expect(block).not.toContain('<cbc:TaxExemptionReasonCode>');

      // Math: line 100 - allowance 30 = TaxExclusive 70, no tax, TaxInclusive 70.
      expect(xml).toContain('<cbc:LineExtensionAmount currencyID="RON">100.00</cbc:LineExtensionAmount>');
      expect(xml).toContain('<cbc:AllowanceTotalAmount currencyID="RON">30.00</cbc:AllowanceTotalAmount>');
      expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="RON">70.00</cbc:TaxExclusiveAmount>');
      expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="RON">70.00</cbc:TaxInclusiveAmount>');
    });

    test('UBL-CR-480: AllowanceCharge TaxCategory must NOT carry a TaxExemptionReasonCode, even for exempt categories', () => {
      // Reproduces the ANAF rejection seen on the ~1% of invoices whose document-level
      // allowance resolves to an exempt-style category (here 'O' via a non-VAT supplier).
      // The exemption reason is legal on the TaxSubtotal/TaxCategory but FORBIDDEN on the
      // AllowanceCharge/TaxCategory:
      //   [UBL-CR-480] not(cac:AllowanceCharge/cac:TaxCategory/cbc:TaxExemptionReasonCode)
      //   [UBL-CR-481] not(cac:AllowanceCharge/cac:TaxCategory/cbc:TaxExemptionReason)
      const nonVatSupplier: Party = {
        ...mockTestData.invoiceData.supplier,
        vatNumber: undefined,
      };

      const xml = builder.generateInvoiceXml({
        ...mockTestData.invoiceData,
        supplier: nonVatSupplier,
        isSupplierVatPayer: false,
        lines: [{ description: 'Service', quantity: 1, unitPrice: 100, taxPercent: 0 }],
        documentAllowanceCharges: [{ chargeIndicator: false, amount: 30, reason: 'Discount' }],
      });

      const acStart = xml.indexOf('<cac:AllowanceCharge>');
      const acEnd = xml.indexOf('</cac:AllowanceCharge>');
      const acBlock = xml.substring(acStart, acEnd);

      // The category id and TaxScheme are still required inside the AllowanceCharge...
      expect(acBlock).toContain('<cbc:ID>O</cbc:ID>');
      expect(acBlock).toContain('<cac:TaxScheme>');
      // ...but the exemption reason must NOT appear there (UBL-CR-480 / UBL-CR-481).
      expect(acBlock).not.toContain('TaxExemptionReasonCode');
      expect(acBlock).not.toContain('TaxExemptionReason');

      // It must still be emitted where it is legal: the document-level TaxSubtotal.
      const taxSubtotalStart = xml.indexOf('<cac:TaxSubtotal>');
      const taxSubtotalEnd = xml.indexOf('</cac:TaxSubtotal>') + '</cac:TaxSubtotal>'.length;
      const taxSubtotal = xml.substring(taxSubtotalStart, taxSubtotalEnd);
      expect(taxSubtotal).toContain('<cbc:TaxExemptionReasonCode>VATEX-EU-O</cbc:TaxExemptionReasonCode>');
    });
  });

  describe('Multi-rate VAT groups with document-level AllowanceCharge', () => {
    /**
     * EN 16931 / CIUS-RO treat the VAT category (BT-118) and the VAT rate (BT-119) as
     * independent: Romania's 21% and 11% rates are both category 'S'. A tax group is
     * therefore identified by the (category, percent) PAIR, never by the category alone.
     *
     * These tests pin that a document-level allowance/charge — the only thing that makes
     * the builder rewrite the tax groups — keeps one cac:TaxSubtotal per distinct rate.
     *
     * Emission order: line tax groups first, in first-appearance order of the lines, then
     * any group created solely by an allowance/charge, in the order those appear.
     */

    /** All cac:TaxSubtotal blocks, in document order. */
    const taxSubtotalsOf = (xml: string): string[] => xml.match(/<cac:TaxSubtotal>[\s\S]*?<\/cac:TaxSubtotal>/g) ?? [];

    /** Two 100 RON lines at Romania's 21% and 11% rates — both category 'S'. */
    const twoRateLines = [
      { description: 'Standard rated', quantity: 1, unitPrice: 100, taxPercent: 21 },
      { description: 'Reduced rated', quantity: 1, unitPrice: 100, taxPercent: 11 },
    ];

    test('two rates + one allowance per rate: each rate keeps its own TaxSubtotal', () => {
      // A document-level discount on a mixed-rate invoice must be split into one
      // allowance per distinct VAT rate (CIUS-RO). Before the (category, percent) keying
      // the second group overwrote the first: 1 subtotal, VAT 8.80, TaxInclusive 188.80.
      const xml = builder.generateInvoiceXml({
        ...mockTestData.invoiceData,
        lines: twoRateLines,
        documentAllowanceCharges: [
          { chargeIndicator: false, amount: 10, reason: 'Discount 21% share', taxCategoryId: 'S', taxPercent: 21 },
          { chargeIndicator: false, amount: 10, reason: 'Discount 11% share', taxCategoryId: 'S', taxPercent: 11 },
        ],
      });

      const subtotals = taxSubtotalsOf(xml);
      expect(subtotals).toHaveLength(2);

      // 21% group: 100 − 10 = 90 base, 90 * 21% = 18.90 VAT.
      expect(subtotals[0]).toContain('<cbc:TaxableAmount currencyID="RON">90.00</cbc:TaxableAmount>');
      expect(subtotals[0]).toContain('<cbc:TaxAmount currencyID="RON">18.90</cbc:TaxAmount>');
      expect(subtotals[0]).toContain('<cbc:ID>S</cbc:ID>');
      expect(subtotals[0]).toContain('<cbc:Percent>21.00</cbc:Percent>');

      // 11% group: 100 − 10 = 90 base, 90 * 11% = 9.90 VAT.
      expect(subtotals[1]).toContain('<cbc:TaxableAmount currencyID="RON">90.00</cbc:TaxableAmount>');
      expect(subtotals[1]).toContain('<cbc:TaxAmount currencyID="RON">9.90</cbc:TaxAmount>');
      expect(subtotals[1]).toContain('<cbc:ID>S</cbc:ID>');
      expect(subtotals[1]).toContain('<cbc:Percent>11.00</cbc:Percent>');

      // Totals: 18.90 + 9.90 = 28.80 VAT on a 180.00 taxable base.
      expect(xml).toContain('<cbc:LineExtensionAmount currencyID="RON">200.00</cbc:LineExtensionAmount>');
      expect(xml).toContain('<cbc:AllowanceTotalAmount currencyID="RON">20.00</cbc:AllowanceTotalAmount>');
      expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="RON">180.00</cbc:TaxExclusiveAmount>');
      expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="RON">208.80</cbc:TaxInclusiveAmount>');
      expect(xml).toContain('<cbc:PayableAmount currencyID="RON">208.80</cbc:PayableAmount>');

      // The collapsed-group signature must not reappear.
      expect(xml).not.toContain('<cbc:TaxInclusiveAmount currencyID="RON">188.80</cbc:TaxInclusiveAmount>');

      // Both AllowanceCharge blocks keep their own rate.
      const acBlocks = xml.match(/<cac:AllowanceCharge>[\s\S]*?<\/cac:AllowanceCharge>/g) ?? [];
      expect(acBlocks).toHaveLength(2);
      expect(acBlocks[0]).toContain('<cbc:Percent>21.00</cbc:Percent>');
      expect(acBlocks[1]).toContain('<cbc:Percent>11.00</cbc:Percent>');
    });

    test('allowance at a rate no line carries gets its own group instead of eating another S group', () => {
      // Single 21% line, allowance declared at 11% → the fallback must synthesise a
      // separate (S, 11) group. Before the fix the allowance was subtracted from the
      // 21% group instead: 1 subtotal of 90.00 / 18.90.
      const xml = builder.generateInvoiceXml({
        ...mockTestData.invoiceData,
        lines: [{ description: 'Standard rated', quantity: 1, unitPrice: 100, taxPercent: 21 }],
        documentAllowanceCharges: [
          { chargeIndicator: false, amount: 10, reason: 'Reduced-rate rebate', taxCategoryId: 'S', taxPercent: 11 },
        ],
      });

      const subtotals = taxSubtotalsOf(xml);
      expect(subtotals).toHaveLength(2);

      // The 21% group is untouched — this is the whole point.
      expect(subtotals[0]).toContain('<cbc:TaxableAmount currencyID="RON">100.00</cbc:TaxableAmount>');
      expect(subtotals[0]).toContain('<cbc:TaxAmount currencyID="RON">21.00</cbc:TaxAmount>');
      expect(subtotals[0]).toContain('<cbc:Percent>21.00</cbc:Percent>');

      // The synthesised 11% group carries the adjustment alone. A negative base is the
      // pre-existing semantics of the "no line at this rate" fallback (an allowance can
      // only subtract); the fix changes where it lands, not how it is computed.
      expect(subtotals[1]).toContain('<cbc:TaxableAmount currencyID="RON">-10.00</cbc:TaxableAmount>');
      expect(subtotals[1]).toContain('<cbc:TaxAmount currencyID="RON">-1.10</cbc:TaxAmount>');
      expect(subtotals[1]).toContain('<cbc:Percent>11.00</cbc:Percent>');

      // 21.00 − 1.10 = 19.90 VAT on a 90.00 base.
      expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="RON">90.00</cbc:TaxExclusiveAmount>');
      expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="RON">109.90</cbc:TaxInclusiveAmount>');
    });

    test("category 'O' allowance merges into the invoice's single 'O' group (percent is not part of the O key)", () => {
      // Category 'O' has no meaningful percent (BR-O-05 forbids cbc:Percent) and always
      // has taxAmount = 0, so percent must be excluded from its group key. The line group
      // is stored as (O, 0) while the resolved allowance carries percent undefined — a
      // naive `${categoryId}-${percent}` key would split those into two 'O' subtotals.
      const nonVatSupplier: Party = {
        ...mockTestData.invoiceData.supplier,
        vatNumber: undefined,
      };

      const xml = builder.generateInvoiceXml({
        ...mockTestData.invoiceData,
        supplier: nonVatSupplier,
        isSupplierVatPayer: false,
        lines: [{ description: 'Service', quantity: 1, unitPrice: 100, taxPercent: 0 }],
        documentAllowanceCharges: [{ chargeIndicator: false, amount: 30, reason: 'Discount' }],
      });

      const subtotals = taxSubtotalsOf(xml);
      expect(subtotals).toHaveLength(1);
      expect(subtotals[0]).toContain('<cbc:TaxableAmount currencyID="RON">70.00</cbc:TaxableAmount>');
      expect(subtotals[0]).toContain('<cbc:TaxAmount currencyID="RON">0.00</cbc:TaxAmount>');
      expect(subtotals[0]).toContain('<cbc:ID>O</cbc:ID>');
      expect(subtotals[0]).not.toContain('<cbc:Percent>');
      expect(subtotals[0]).toContain('<cbc:TaxExemptionReasonCode>VATEX-EU-O</cbc:TaxExemptionReasonCode>');
    });

    test("category 'O' allowance on a multi-rate invoice sits alongside both rated groups", () => {
      // Three distinct groups: (S, 21), (S, 11) and (O). Before the fix the two S groups
      // collapsed and only 2 subtotals were emitted, with VAT 11.00 instead of 32.00.
      const xml = builder.generateInvoiceXml({
        ...mockTestData.invoiceData,
        lines: twoRateLines,
        documentAllowanceCharges: [
          { chargeIndicator: false, amount: 10, reason: 'Non-taxable rebate', taxCategoryId: 'O', taxPercent: 0 },
        ],
      });

      const subtotals = taxSubtotalsOf(xml);
      expect(subtotals).toHaveLength(3);

      expect(subtotals[0]).toContain('<cbc:TaxableAmount currencyID="RON">100.00</cbc:TaxableAmount>');
      expect(subtotals[0]).toContain('<cbc:TaxAmount currencyID="RON">21.00</cbc:TaxAmount>');
      expect(subtotals[0]).toContain('<cbc:Percent>21.00</cbc:Percent>');

      expect(subtotals[1]).toContain('<cbc:TaxableAmount currencyID="RON">100.00</cbc:TaxableAmount>');
      expect(subtotals[1]).toContain('<cbc:TaxAmount currencyID="RON">11.00</cbc:TaxAmount>');
      expect(subtotals[1]).toContain('<cbc:Percent>11.00</cbc:Percent>');

      // 'O' carries the allowance, no VAT and no Percent.
      expect(subtotals[2]).toContain('<cbc:TaxableAmount currencyID="RON">-10.00</cbc:TaxableAmount>');
      expect(subtotals[2]).toContain('<cbc:TaxAmount currencyID="RON">0.00</cbc:TaxAmount>');
      expect(subtotals[2]).toContain('<cbc:ID>O</cbc:ID>');
      expect(subtotals[2]).not.toContain('<cbc:Percent>');

      // 21.00 + 11.00 + 0.00 = 32.00 VAT on a 190.00 base.
      expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="RON">190.00</cbc:TaxExclusiveAmount>');
      expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="RON">222.00</cbc:TaxInclusiveAmount>');
    });

    test('allowance at 21% and charge at 11% each adjust only their own group', () => {
      // Both directions flow through the same grouping code. Before the fix the two S
      // groups collapsed and the net −10 + 20 landed on a single 11% base: VAT 12.10.
      const xml = builder.generateInvoiceXml({
        ...mockTestData.invoiceData,
        lines: twoRateLines,
        documentAllowanceCharges: [
          { chargeIndicator: false, amount: 10, reason: 'Discount', taxCategoryId: 'S', taxPercent: 21 },
          { chargeIndicator: true, amount: 20, reason: 'Shipping', taxCategoryId: 'S', taxPercent: 11 },
        ],
      });

      const subtotals = taxSubtotalsOf(xml);
      expect(subtotals).toHaveLength(2);

      // 21% group: 100 − 10 = 90 base, 18.90 VAT.
      expect(subtotals[0]).toContain('<cbc:TaxableAmount currencyID="RON">90.00</cbc:TaxableAmount>');
      expect(subtotals[0]).toContain('<cbc:TaxAmount currencyID="RON">18.90</cbc:TaxAmount>');
      expect(subtotals[0]).toContain('<cbc:Percent>21.00</cbc:Percent>');

      // 11% group: 100 + 20 = 120 base, 13.20 VAT.
      expect(subtotals[1]).toContain('<cbc:TaxableAmount currencyID="RON">120.00</cbc:TaxableAmount>');
      expect(subtotals[1]).toContain('<cbc:TaxAmount currencyID="RON">13.20</cbc:TaxAmount>');
      expect(subtotals[1]).toContain('<cbc:Percent>11.00</cbc:Percent>');

      // 18.90 + 13.20 = 32.10 VAT on a 210.00 base.
      expect(xml).toContain('<cbc:AllowanceTotalAmount currencyID="RON">10.00</cbc:AllowanceTotalAmount>');
      expect(xml).toContain('<cbc:ChargeTotalAmount currencyID="RON">20.00</cbc:ChargeTotalAmount>');
      expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="RON">210.00</cbc:TaxExclusiveAmount>');
      expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="RON">242.10</cbc:TaxInclusiveAmount>');
    });

    test('multi-rate invoice with no document allowances is byte-identical to the v1.5.0 output', () => {
      // The allowance code path early-returns when there is nothing to apply, so this
      // invoice must be completely unaffected. The two literals below were captured from
      // v1.5.0 (pre-fix) output and must survive the change unchanged.
      const multiRateInvoice: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: twoRateLines,
      };

      const xml = builder.generateInvoiceXml(multiRateInvoice);

      const taxTotal = xml.substring(
        xml.indexOf('<cac:TaxTotal>'),
        xml.indexOf('</cac:TaxTotal>') + '</cac:TaxTotal>'.length
      );
      expect(taxTotal).toBe(
        `<cac:TaxTotal>
    <cbc:TaxAmount currencyID="RON">32.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="RON">100.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="RON">21.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>21.00</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="RON">100.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="RON">11.00</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>11.00</cbc:Percent>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>`
      );

      const legalMonetaryTotal = xml.substring(
        xml.indexOf('<cac:LegalMonetaryTotal>'),
        xml.indexOf('</cac:LegalMonetaryTotal>') + '</cac:LegalMonetaryTotal>'.length
      );
      expect(legalMonetaryTotal).toBe(
        `<cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="RON">200.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="RON">200.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="RON">232.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="RON">232.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>`
      );

      // An empty documentAllowanceCharges array takes the same early-return path.
      expect(builder.generateInvoiceXml({ ...multiRateInvoice, documentAllowanceCharges: [] })).toBe(xml);
    });
  });

  describe('Ambiguous VAT rate on a document-level AllowanceCharge', () => {
    /**
     * A tax category does not identify a tax group on its own — 'S' can cover several
     * rates. When an allowance names a category that several line groups share and does
     * not say which rate it applies to, the builder must refuse to guess.
     *
     * Guessing is worse than failing here: inheriting the wrong rate yields an invoice
     * that reconciles arithmetically (every total still adds up) while filing the wrong
     * amount of VAT, which is close to undetectable downstream.
     */

    const twoRateLines = [
      { description: 'Standard rated', quantity: 1, unitPrice: 100, taxPercent: 21 },
      { description: 'Reduced rated', quantity: 1, unitPrice: 100, taxPercent: 11 },
    ];

    const taxSubtotalsOf = (xml: string): string[] => xml.match(/<cac:TaxSubtotal>[\s\S]*?<\/cac:TaxSubtotal>/g) ?? [];

    test("allowance naming category 'S' without taxPercent throws when lines carry several 'S' rates", () => {
      // Previously this silently inherited the FIRST matching group's percent (21), so a
      // discount meant for the 11% base was filed at 21%.
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: twoRateLines,
        documentAllowanceCharges: [{ chargeIndicator: false, amount: 10, reason: 'Discount', taxCategoryId: 'S' }],
      };

      // UblBuilder wraps the builder error in AnafValidationError — assert on the
      // inner message text, as the other throwing tests in this file do.
      expect(() => builder.generateInvoiceXml(invoiceData)).toThrow(/taxPercent is required/);

      // The message must name the category and both candidate rates — a generic
      // "ambiguous" string would leave the caller guessing which value to supply.
      let message = '';
      try {
        builder.generateInvoiceXml(invoiceData);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain('Allowance/Charge 1');
      expect(message).toContain('taxPercent');
      expect(message).toContain("'S'");
      expect(message).toContain('21%');
      expect(message).toContain('11%');
    });

    test('allowance with an explicit taxPercent is unambiguous and lands in that rate group', () => {
      const xml = builder.generateInvoiceXml({
        ...mockTestData.invoiceData,
        lines: twoRateLines,
        documentAllowanceCharges: [
          { chargeIndicator: false, amount: 10, reason: 'Discount', taxCategoryId: 'S', taxPercent: 11 },
        ],
      });

      const subtotals = taxSubtotalsOf(xml);
      expect(subtotals).toHaveLength(2);

      // 21% group untouched, 11% group carries the discount: 100 − 10 = 90 → 9.90 VAT.
      expect(subtotals[0]).toContain('<cbc:TaxableAmount currencyID="RON">100.00</cbc:TaxableAmount>');
      expect(subtotals[0]).toContain('<cbc:TaxAmount currencyID="RON">21.00</cbc:TaxAmount>');
      expect(subtotals[1]).toContain('<cbc:TaxableAmount currencyID="RON">90.00</cbc:TaxableAmount>');
      expect(subtotals[1]).toContain('<cbc:TaxAmount currencyID="RON">9.90</cbc:TaxAmount>');

      // 21.00 + 9.90 = 30.90 VAT on a 190.00 base.
      expect(xml).toContain('<cbc:TaxExclusiveAmount currencyID="RON">190.00</cbc:TaxExclusiveAmount>');
      expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="RON">220.90</cbc:TaxInclusiveAmount>');
    });

    test('single-rate invoice still infers the percent from its one matching group', () => {
      // The common case: exactly one 'S' group, so there is nothing to disambiguate and
      // omitting taxPercent must keep working.
      const xml = builder.generateInvoiceXml({
        ...mockTestData.invoiceData,
        // mockTestData has a single 100 RON line at 19%.
        documentAllowanceCharges: [{ chargeIndicator: false, amount: 20, reason: 'Promo', taxCategoryId: 'S' }],
      });

      const acBlocks = xml.match(/<cac:AllowanceCharge>[\s\S]*?<\/cac:AllowanceCharge>/g) ?? [];
      expect(acBlocks).toHaveLength(1);
      expect(acBlocks[0]).toContain('<cbc:ID>S</cbc:ID>');
      expect(acBlocks[0]).toContain('<cbc:Percent>19.00</cbc:Percent>');

      const subtotals = taxSubtotalsOf(xml);
      expect(subtotals).toHaveLength(1);
      expect(subtotals[0]).toContain('<cbc:TaxableAmount currencyID="RON">80.00</cbc:TaxableAmount>');
      expect(subtotals[0]).toContain('<cbc:TaxAmount currencyID="RON">15.20</cbc:TaxAmount>');
      expect(xml).toContain('<cbc:TaxInclusiveAmount currencyID="RON">95.20</cbc:TaxInclusiveAmount>');
    });

    test("category 'O' is never rate-ambiguous, on either of the two routes that reach it", () => {
      // Route 1 — non-VAT supplier. Every allowance is coerced to 'O' before any
      // category/rate matching happens, so even multi-percent 'O' line groups cannot
      // trigger the ambiguity error.
      const nonVatSupplier: Party = { ...mockTestData.invoiceData.supplier, vatNumber: undefined };
      const nonVatInvoice: InvoiceInput = {
        ...mockTestData.invoiceData,
        supplier: nonVatSupplier,
        isSupplierVatPayer: false,
        lines: [
          { description: 'Service A', quantity: 1, unitPrice: 100, taxPercent: 0 },
          { description: 'Service B', quantity: 1, unitPrice: 50, taxPercent: 19 },
        ],
        documentAllowanceCharges: [{ chargeIndicator: false, amount: 30, reason: 'Discount', taxCategoryId: 'O' }],
      };

      expect(() => builder.generateInvoiceXml(nonVatInvoice)).not.toThrow();
      const nonVatAcBlock = builder
        .generateInvoiceXml(nonVatInvoice)
        .match(/<cac:AllowanceCharge>[\s\S]*?<\/cac:AllowanceCharge>/)![0];
      expect(nonVatAcBlock).toContain('<cbc:ID>O</cbc:ID>');
      // BR-O-05: 'O' carries no percent, which is exactly why it cannot be ambiguous.
      expect(nonVatAcBlock).not.toContain('<cbc:Percent>');

      // Route 2 — VAT supplier, mixed rates, explicit 'O' allowance. Unchanged: it still
      // gets its own subtotal alongside both rated groups.
      const mixedInvoice: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: twoRateLines,
        documentAllowanceCharges: [
          { chargeIndicator: false, amount: 10, reason: 'Non-taxable rebate', taxCategoryId: 'O', taxPercent: 0 },
        ],
      };

      expect(() => builder.generateInvoiceXml(mixedInvoice)).not.toThrow();
      expect(taxSubtotalsOf(builder.generateInvoiceXml(mixedInvoice))).toHaveLength(3);
    });
  });

  describe('Performance Tests', () => {
    test('should generate XML quickly for simple invoices', () => {
      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        builder.generateInvoiceXml(mockTestData.invoiceData);
      }

      const duration = Date.now() - start;

      // Should complete 100 generations in reasonable time (less than 1 second)
      expect(duration).toBeLessThan(1000);
    });

    test('should handle large invoices efficiently', () => {
      const largeInvoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        lines: Array.from({ length: 100 }, (_, i) => ({
          description: `Item ${i + 1}`,
          quantity: Math.floor(Math.random() * 10) + 1,
          unitPrice: Math.round(Math.random() * 1000 * 100) / 100,
          taxPercent: 19,
        })),
      };

      const start = Date.now();
      const xml = builder.generateInvoiceXml(largeInvoiceData);
      const duration = Date.now() - start;

      expect(xml).toBeDefined();
      expect(xml.length).toBeGreaterThan(1000);
      expect(duration).toBeLessThan(500); // Should complete in reasonable time
    });
  });
});
