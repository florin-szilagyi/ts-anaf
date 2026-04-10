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

    test('should handle EUR currency correctly', () => {
      const invoiceData: InvoiceInput = {
        ...mockTestData.invoiceData,
        currency: 'EUR',
      };

      const xml = builder.generateInvoiceXml(invoiceData);

      expect(xml).toContain('<cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>');
      expect(xml).toContain('currencyID="EUR"');
      expect(xml).not.toContain('currencyID="RON"');
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
