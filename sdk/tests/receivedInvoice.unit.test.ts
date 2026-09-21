import { AnafAmbiguousTaxTotalError, AnafValidationError, AnafXmlParsingError } from '../src/errors';
import { parseReceivedInvoice } from '../src/ubl/receivedInvoice';

/*
 * Every document below is SYNTHETIC: invented parties ("Exemplu SRL"),
 * invented VAT ids, invented amounts. Never paste a real invoice here.
 */

const UBL_INVOICE = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>EXMPL-2026-001</cbc:ID>
  <cbc:IssueDate>2026-08-01</cbc:IssueDate>
  <cbc:DueDate>2026-08-31</cbc:DueDate>
  <cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PostalAddress>
        <cbc:StreetName>Strada Exemplu 1</cbc:StreetName>
        <cbc:CityName>Cluj-Napoca</cbc:CityName>
        <cbc:PostalZone>400001</cbc:PostalZone>
        <cbc:CountrySubentity>RO-CJ</cbc:CountrySubentity>
        <cac:Country><cbc:IdentificationCode>RO</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>RO12345678</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>Exemplu SRL</cbc:RegistrationName>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:InvoiceLine>
    <cbc:ID>10</cbc:ID>
    <cbc:InvoicedQuantity unitCode="H87">2.5000</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="RON">100.0000</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Material exemplu</cbc:Name>
      <cac:SellersItemIdentification><cbc:ID>MAT-001</cbc:ID></cac:SellersItemIdentification>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>19.000</cbc:Percent>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="RON">40.0000</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
  <cac:TaxTotal><cbc:TaxAmount currencyID="RON">19.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="RON">100.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="RON">119.00</cbc:TaxInclusiveAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;

const UBL_CREDIT_NOTE = `<?xml version="1.0" encoding="UTF-8"?>
<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>EXMPL-CN-002</cbc:ID>
  <cbc:IssueDate>2026-08-05</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>Exemplu Distribuție SRL</cbc:Name></cac:PartyName>
      <cac:PartyLegalEntity><cbc:CompanyID>RO87654321</cbc:CompanyID></cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:CreditNoteLine>
    <cbc:ID>CN-1</cbc:ID>
    <cbc:CreditedQuantity unitCode="C62">-1.00</cbc:CreditedQuantity>
    <cbc:LineExtensionAmount currencyID="RON">-10.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Corecție exemplu</cbc:Name>
      <cac:SellersItemIdentification><cbc:ID>CORECT-1</cbc:ID></cac:SellersItemIdentification>
      <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>19</cbc:Percent></cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="RON">10.00</cbc:PriceAmount></cac:Price>
  </cac:CreditNoteLine>
  <cac:TaxTotal><cbc:TaxAmount currencyID="RON">-1.90</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="RON">-10.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="RON">-11.90</cbc:TaxInclusiveAmount>
  </cac:LegalMonetaryTotal>
</CreditNote>`;

const CII_INVOICE = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocument>
    <ram:ID>EXMPL-CII-003</ram:ID>
    <ram:IssueDateTime><udt:DateTimeString format="102">20260810</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>cii-7</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:SellerAssignedID>IND-007</ram:SellerAssignedID>
        <ram:Name>Serviciu industrial exemplu</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>80.1250</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="HUR">2.500</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>19.00</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>200.3125</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>Exemplu Industrial SA</ram:Name>
        <ram:PostalTradeAddress>
          <ram:PostcodeCode>010101</ram:PostcodeCode>
          <ram:LineOne>Bd. Exemplu 10</ram:LineOne>
          <ram:CityName>București</ram:CityName>
          <ram:CountryID>RO</ram:CountryID>
        </ram:PostalTradeAddress>
        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">RO55555555</ram:ID>
        </ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradePaymentTerms>
        <ram:DueDateDateTime><udt:DateTimeString format="102">20260909</udt:DateTimeString></ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:TaxBasisTotalAmount>200.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">38.00</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>238.00</ram:GrandTotalAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

/** The same synthetic document, carrying the UNTDID 1001 code under test. */
const invoiceWithCode = (code: string) =>
  UBL_INVOICE.replace(
    '<cbc:IssueDate>2026-08-01</cbc:IssueDate>',
    `<cbc:IssueDate>2026-08-01</cbc:IssueDate>
  <cbc:InvoiceTypeCode>${code}</cbc:InvoiceTypeCode>`
  );

const creditNoteWithCode = (code: string) =>
  UBL_CREDIT_NOTE.replace(
    '<cbc:IssueDate>2026-08-05</cbc:IssueDate>',
    `<cbc:IssueDate>2026-08-05</cbc:IssueDate>
  <cbc:CreditNoteTypeCode>${code}</cbc:CreditNoteTypeCode>`
  );

const VAT_LINE_CASES = [
  {
    standard: 'UBL',
    missingCategory: UBL_INVOICE.replace(/\s*<cac:ClassifiedTaxCategory>[\s\S]*?<\/cac:ClassifiedTaxCategory>/, ''),
    missingRate: UBL_INVOICE.replace('\n        <cbc:Percent>19.000</cbc:Percent>', ''),
    notSubjectToVat: UBL_INVOICE.replace('<cbc:ID>S</cbc:ID>', '<cbc:ID>O</cbc:ID>').replace(
      '\n        <cbc:Percent>19.000</cbc:Percent>',
      ''
    ),
  },
  {
    standard: 'CII',
    missingCategory: CII_INVOICE.replace('<ram:CategoryCode>S</ram:CategoryCode>', ''),
    missingRate: CII_INVOICE.replace('<ram:RateApplicablePercent>19.00</ram:RateApplicablePercent>', ''),
    notSubjectToVat: CII_INVOICE.replace(
      '<ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>19.00</ram:RateApplicablePercent>',
      '<ram:CategoryCode>O</ram:CategoryCode>'
    ),
  },
] as const;

const MULTI_TAX_TOTAL_AMBIGUOUS = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>EXMPL-2026-004</cbc:ID>
  <cbc:IssueDate>2026-08-01</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>
  <cac:TaxTotal><cbc:TaxAmount currencyID="RON">19.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:TaxTotal><cbc:TaxAmount currencyID="RON">3.80</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxInclusiveAmount currencyID="RON">119.00</cbc:TaxInclusiveAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;

const MULTI_TAX_TOTAL_RESOLVABLE = MULTI_TAX_TOTAL_AMBIGUOUS.replace(
  '<cac:TaxTotal><cbc:TaxAmount currencyID="RON">3.80</cbc:TaxAmount></cac:TaxTotal>',
  '<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">3.80</cbc:TaxAmount></cac:TaxTotal>'
);

const MALFORMED_AMOUNTS = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>EXMPL-2026-005</cbc:ID>
  <cbc:IssueDate>2026-13-45</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>lei românești</cbc:DocumentCurrencyCode>
  <cac:TaxTotal><cbc:TaxAmount currencyID="RON">19,00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="RON">1.0e2</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="RON">o sută</cbc:TaxInclusiveAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;

describe('parseReceivedInvoice', () => {
  it('reads a UBL invoice header, amounts staying decimal strings', () => {
    const parsed = parseReceivedInvoice(UBL_INVOICE);

    expect(parsed).toEqual({
      documentStandard: 'ubl',
      documentKind: 'invoice',
      creditNoteTypeCode: null,
      pdfStandard: 'FACT1',
      billingReference: null,
      invoiceNumber: 'EXMPL-2026-001',
      issueDate: '2026-08-01',
      dueDate: '2026-08-31',
      currencyCode: 'RON',
      supplierName: 'Exemplu SRL',
      supplierVatCode: 'RO12345678',
      supplierAddress: {
        street: 'Strada Exemplu 1',
        city: 'Cluj-Napoca',
        county: 'RO-CJ',
        postalZone: '400001',
        countryCode: 'RO',
      },
      subtotalAmount: '100.00',
      taxAmount: '19.00',
      totalAmount: '119.00',
      sourceLines: [
        {
          sourceId: '10',
          sourceOrder: 1,
          supplierItemCode: 'MAT-001',
          name: 'Material exemplu',
          quantity: '2.5000',
          unitCode: 'H87',
          unitPrice: '40.0000',
          netAmount: '100.0000',
          taxCategory: 'S',
          taxRate: '19.000',
        },
      ],
      sourceLineDiagnostics: [],
    });
    // Exact decimals: these must never become floats.
    expect(typeof parsed.totalAmount).toBe('string');
  });

  it('reads a UBL credit note, falling back through the name and VAT sources', () => {
    const parsed = parseReceivedInvoice(UBL_CREDIT_NOTE);

    expect(parsed.documentKind).toBe('credit_note');
    // The PDF standard follows the ROOT element: CreditNote converts as FCN.
    expect(parsed.pdfStandard).toBe('FCN');
    expect(parsed.supplierName).toBe('Exemplu Distribuție SRL');
    expect(parsed.supplierVatCode).toBe('RO87654321');
    expect(parsed.totalAmount).toBe('-11.90');
    expect(parsed.sourceLines).toEqual([
      {
        sourceId: 'CN-1',
        sourceOrder: 1,
        supplierItemCode: 'CORECT-1',
        name: 'Corecție exemplu',
        quantity: '-1.00',
        unitCode: 'C62',
        unitPrice: '10.00',
        netAmount: '-10.00',
        taxCategory: 'S',
        taxRate: '19',
      },
    ]);
  });

  it('reads a 384 corrective (storno) with its original-invoice reference', () => {
    const corrective = UBL_INVOICE.replace(
      '<cbc:IssueDate>2026-08-01</cbc:IssueDate>',
      `<cbc:IssueDate>2026-08-01</cbc:IssueDate>
  <cbc:InvoiceTypeCode>384</cbc:InvoiceTypeCode>`
    ).replace(
      '<cac:AccountingSupplierParty>',
      `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>EXMPL-2025-042</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>
  <cac:AccountingSupplierParty>`
    );

    const parsed = parseReceivedInvoice(corrective);
    expect(parsed.documentKind).toBe('corrective');
    expect(parsed.billingReference).toBe('EXMPL-2025-042');
    // Still an Invoice root: the PDF converts as FACT1, not FCN.
    expect(parsed.pdfStandard).toBe('FACT1');
  });

  it('maps 380/381/384 on an Invoice root and keeps an unknown type code verbatim', () => {
    expect(parseReceivedInvoice(invoiceWithCode('380')).documentKind).toBe('invoice');
    expect(parseReceivedInvoice(invoiceWithCode('381')).documentKind).toBe('credit_note');
    expect(parseReceivedInvoice(invoiceWithCode('384')).documentKind).toBe('corrective');
    expect(parseReceivedInvoice(invoiceWithCode('389')).documentKind).toBe('389');
    expect(parseReceivedInvoice(invoiceWithCode('751')).documentKind).toBe('751');
  });

  /*
   * A CreditNote ROOT reverses value whatever its type code. 261 (self-billed)
   * and 396 (factored) credit notes used to come out as the raw code, which a
   * downstream ledger refuses to allocate — the root decides. 380 is the
   * sharpest case: read as "invoice" it would be signed +1 downstream.
   */
  it('reads every CreditNote root as a credit note whatever its type code', () => {
    for (const code of ['381', '396', '261', '380']) {
      const parsed = parseReceivedInvoice(creditNoteWithCode(code));
      expect(parsed.documentKind).toBe('credit_note');
      expect(parsed.pdfStandard).toBe('FCN');
      // Negative totals stay decimal strings, not floats.
      expect(parsed.totalAmount).toBe('-11.90');
    }
  });

  /*
   * The flattened code is observable on its own field, never folded into a
   * document-level defect: a 396 credit note is a perfectly good document.
   */
  it('reports a flattened credit-note type code without diagnosing the document', () => {
    expect(parseReceivedInvoice(creditNoteWithCode('396')).creditNoteTypeCode).toBe('396');
    expect(parseReceivedInvoice(creditNoteWithCode('396')).sourceLineDiagnostics).toEqual([]);
    // 381 is the expected code: nothing was flattened, nothing to report.
    expect(parseReceivedInvoice(creditNoteWithCode('381')).creditNoteTypeCode).toBeNull();
    expect(parseReceivedInvoice(UBL_CREDIT_NOTE).creditNoteTypeCode).toBeNull();
    expect(parseReceivedInvoice(invoiceWithCode('380')).creditNoteTypeCode).toBeNull();
  });

  it('reads a CII invoice, converting the compact dates', () => {
    const parsed = parseReceivedInvoice(CII_INVOICE);

    expect(parsed).toMatchObject({
      documentStandard: 'cii',
      documentKind: 'invoice',
      pdfStandard: 'FACT1',
      billingReference: null,
      invoiceNumber: 'EXMPL-CII-003',
      issueDate: '2026-08-10',
      dueDate: '2026-09-09',
      currencyCode: 'EUR',
      supplierName: 'Exemplu Industrial SA',
      supplierVatCode: 'RO55555555',
      subtotalAmount: '200.00',
      taxAmount: '38.00',
      totalAmount: '238.00',
      sourceLines: [
        {
          sourceId: 'cii-7',
          sourceOrder: 1,
          supplierItemCode: 'IND-007',
          name: 'Serviciu industrial exemplu',
          quantity: '2.500',
          unitCode: 'HUR',
          unitPrice: '80.1250',
          netAmount: '200.3125',
          taxCategory: 'S',
          taxRate: '19.00',
        },
      ],
      sourceLineDiagnostics: [],
    });
  });

  it.each(VAT_LINE_CASES)('reports a missing VAT category on a $standard source line', ({ missingCategory }) => {
    const parsed = parseReceivedInvoice(missingCategory);

    expect(parsed.sourceLines[0]).toMatchObject({ taxCategory: null });
    expect(parsed.sourceLineDiagnostics).toEqual(['Source line 1 has missing required fields: VAT category.']);
  });

  it.each(VAT_LINE_CASES)('reports a missing VAT rate on an applicable $standard source line', ({ missingRate }) => {
    const parsed = parseReceivedInvoice(missingRate);

    expect(parsed.sourceLines[0]).toMatchObject({ taxCategory: 'S', taxRate: null });
    expect(parsed.sourceLineDiagnostics).toEqual(['Source line 1 has missing required fields: VAT rate.']);
  });

  it.each(VAT_LINE_CASES)('accepts an absent VAT rate for a category O $standard source line', ({ notSubjectToVat }) => {
    const parsed = parseReceivedInvoice(notSubjectToVat);

    expect(parsed.sourceLines[0]).toMatchObject({ taxCategory: 'O', taxRate: null });
    expect(parsed.sourceLineDiagnostics).toEqual([]);
  });

  it('keeps unpublished source and supplier item identifiers optional', () => {
    const withoutOptionalIds = UBL_INVOICE.replace('    <cbc:ID>10</cbc:ID>\n', '').replace(
      '      <cac:SellersItemIdentification><cbc:ID>MAT-001</cbc:ID></cac:SellersItemIdentification>\n',
      ''
    );

    const parsed = parseReceivedInvoice(withoutOptionalIds);

    expect(parsed.sourceLines[0]).toMatchObject({ sourceId: null, supplierItemCode: null });
    expect(parsed.sourceLineDiagnostics).toEqual([]);
  });

  it('throws on currency-ambiguous multiple tax totals instead of guessing', () => {
    expect(() => parseReceivedInvoice(MULTI_TAX_TOTAL_AMBIGUOUS)).toThrow(/Ambiguous VAT total/);
    expect(() => parseReceivedInvoice(MULTI_TAX_TOTAL_AMBIGUOUS)).toThrow(AnafAmbiguousTaxTotalError);
  });

  it('resolves multiple tax totals when exactly one matches the document currency', () => {
    expect(parseReceivedInvoice(MULTI_TAX_TOTAL_RESOLVABLE).taxAmount).toBe('19.00');
  });

  it('rejects malformed amounts, dates and currencies to null, never coercing', () => {
    const parsed = parseReceivedInvoice(MALFORMED_AMOUNTS);

    expect(parsed.issueDate).toBeNull();
    expect(parsed.currencyCode).toBeNull();
    expect(parsed.taxAmount).toBeNull(); // "19,00" is not a decimal string
    expect(parsed.subtotalAmount).toBeNull(); // scientific notation rejected
    expect(parsed.totalAmount).toBeNull(); // prose rejected
  });

  it('retains a malformed source line and reports every invalid decimal', () => {
    const malformedLine = UBL_INVOICE.replace('2.5000', 'două')
      .replace('40.0000', '4e1')
      .replace('19.000', 'nouăsprezece');

    const parsed = parseReceivedInvoice(malformedLine);

    expect(parsed.sourceLines[0]).toMatchObject({
      sourceId: '10',
      quantity: null,
      unitPrice: null,
      netAmount: '100.0000',
      taxRate: null,
    });
    expect(parsed.sourceLineDiagnostics).toEqual([
      'Source line 1 has invalid decimal fields: quantity, unit price, VAT rate.',
    ]);
  });

  it('reports a supported document with no source lines', () => {
    const withoutLine = UBL_INVOICE.replace(/\s*<cac:InvoiceLine>[\s\S]*?<\/cac:InvoiceLine>/, '');

    const parsed = parseReceivedInvoice(withoutLine);

    expect(parsed.sourceLines).toEqual([]);
    expect(parsed.sourceLineDiagnostics).toEqual(['Source document has no invoice lines.']);
  });

  it('throws on non-XML and on unsupported roots', () => {
    expect(() => parseReceivedInvoice('not xml at all')).toThrow(/not well-formed XML/);
    expect(() => parseReceivedInvoice('not xml at all')).toThrow(AnafXmlParsingError);
    expect(() => parseReceivedInvoice('<Altceva><ID>1</ID></Altceva>')).toThrow(/Unsupported document root: Altceva/);
    expect(() => parseReceivedInvoice('<Altceva><ID>1</ID></Altceva>')).toThrow(AnafValidationError);
  });

  it('refuses documents beyond the size guard', () => {
    const huge = `<Invoice>${'a'.repeat(13 * 1024 * 1024)}</Invoice>`;
    expect(() => parseReceivedInvoice(huge)).toThrow(/too large/);
    expect(() => parseReceivedInvoice(huge)).toThrow(AnafValidationError);
  });

  it('decodes the five predefined entities without enabling expansion', () => {
    const withEntities = `<?xml version="1.0"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>EXMPL-&quot;7&quot;</cbc:ID>
  <cbc:IssueDate>2026-08-01</cbc:IssueDate>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyLegalEntity>
      <cbc:RegistrationName>Alfa &amp; Beta &lt;SRL&gt; &apos;Exemplu&apos;</cbc:RegistrationName>
    </cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:LegalMonetaryTotal>
    <cbc:TaxInclusiveAmount currencyID="RON">119.00</cbc:TaxInclusiveAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;

    const parsed = parseReceivedInvoice(withEntities);
    expect(parsed.supplierName).toBe("Alfa & Beta <SRL> 'Exemplu'");
    expect(parsed.invoiceNumber).toBe('EXMPL-"7"');
  });

  it('decodes doubly-encoded entities exactly once (amp last)', () => {
    const doubled = `<?xml version="1.0"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>EXMPL-&amp;lt;8&amp;amp;</cbc:ID>
  <cbc:IssueDate>2026-08-01</cbc:IssueDate>
</Invoice>`;

    // XML semantics: &amp;lt; is the literal text "&lt;", never "<".
    expect(parseReceivedInvoice(doubled).invoiceNumber).toBe('EXMPL-&lt;8&amp;');
  });

  it('decodes decimal and hex character references', () => {
    // Romanian suppliers routinely publish diacritics as character
    // references; leaving them encoded corrupted every supplier name.
    const charRefs = `<?xml version="1.0"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>EXMPL-S&#259;pt&#x103;m&#38;na</cbc:ID>
  <cbc:IssueDate>2026-08-01</cbc:IssueDate>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyLegalEntity>
      <cbc:RegistrationName>Exemplu &#206;nt&#x103;rire SRL</cbc:RegistrationName>
    </cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
</Invoice>`;

    const parsed = parseReceivedInvoice(charRefs);
    expect(parsed.supplierName).toBe('Exemplu Întărire SRL');
    // &#38; is the ampersand, decoded exactly like &amp;.
    expect(parsed.invoiceNumber).toBe('EXMPL-Săptăm&na');
  });

  it('decodes a character reference exactly once, never re-reading its output', () => {
    // `&#38;amp;` is the literal text "&amp;": one level of decoding turns
    // &#38; into "&" and leaves "amp;" alone. A pass-per-entity decoder would
    // re-read that output and wrongly collapse it to "&".
    const once = `<?xml version="1.0"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>EXMPL-&#38;amp;-&#38;lt;</cbc:ID>
  <cbc:IssueDate>2026-08-01</cbc:IssueDate>
</Invoice>`;

    expect(parseReceivedInvoice(once).invoiceNumber).toBe('EXMPL-&amp;-&lt;');
  });

  it('leaves an out-of-range character reference as literal text', () => {
    // String.fromCodePoint would throw on these; the document is still
    // readable, so the reference stays put instead.
    const outOfRange = `<?xml version="1.0"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>EXMPL-&#1114112;-&#xD800;-&#0;</cbc:ID>
  <cbc:IssueDate>2026-08-01</cbc:IssueDate>
</Invoice>`;

    expect(parseReceivedInvoice(outOfRange).invoiceNumber).toBe('EXMPL-&#1114112;-&#xD800;-&#0;');
  });

  it('resolves a tax total whose currency attribute arrives as a character reference', () => {
    // R&#79;N is "RON". Undecoded, neither TaxTotal matched the document
    // currency and the document was refused as ambiguous.
    const encodedCurrency = MULTI_TAX_TOTAL_AMBIGUOUS.replace(
      '<cac:TaxTotal><cbc:TaxAmount currencyID="RON">3.80</cbc:TaxAmount></cac:TaxTotal>',
      '<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">3.80</cbc:TaxAmount></cac:TaxTotal>'
    ).replace('currencyID="RON">19.00', 'currencyID="R&#79;N">19.00');

    expect(parseReceivedInvoice(encodedCurrency).taxAmount).toBe('19.00');
  });

  it('never expands XML entities (supplier-authored input)', () => {
    // A "billion laughs" shape: with entity processing on, &d; would expand
    // multiplicatively and balloon memory inside a bulk sweep. The parser must
    // treat references as inert text — either rejecting the document or
    // passing the reference through UNEXPANDED.
    const nested = `<?xml version="1.0"?>
<!DOCTYPE Invoice [
  <!ENTITY a "exemplu-exemplu-exemplu">
  <!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">
  <!ENTITY c "&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;">
  <!ENTITY d "&c;&c;&c;&c;&c;&c;&c;&c;&c;&c;">
]>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>&d;</cbc:ID>
  <cbc:IssueDate>2026-08-01</cbc:IssueDate>
</Invoice>`;

    let invoiceNumber: string | null = null;
    try {
      invoiceNumber = parseReceivedInvoice(nested).invoiceNumber;
    } catch {
      // Outright rejection is equally acceptable — just never expansion.
      return;
    }
    expect(invoiceNumber ?? '').not.toContain('exemplu-exemplu-exemplu');
  });
});
