import { XMLParser, XMLValidator } from 'fast-xml-parser';

import { AnafAmbiguousTaxTotalError, AnafValidationError, AnafXmlParsingError } from '../errors';

/**
 * Parser for the invoice documents ANAF delivers through SPV: UBL 2.1
 * `Invoice`/`CreditNote` and CII `CrossIndustryInvoice`.
 *
 * Amounts are validated decimal STRINGS, never numbers: callers put
 * them in exact-decimal storage and they must not pass through float
 * representation. A document with several `TaxTotal` amounts and no unique
 * match on the document currency throws instead of guessing.
 */

/** One line exactly as the source document published it. */
export type ReceivedInvoiceLine = {
  /** Identifier exactly as published by the source document. */
  sourceId: string | null;
  /** One-based order in the source document; stable even when sourceId is absent. */
  sourceOrder: number;
  supplierItemCode: string | null;
  name: string | null;
  /**
   * Decimal strings, never JavaScript numbers. Every published digit is
   * preserved, including leading zeros and trailing fractional zeros; only
   * the sign and an empty integer or fraction part are normalised, so a
   * supplier's `+2.50`, `.5` and `5.` arrive as `2.50`, `0.5` and `5`.
   */
  quantity: string | null;
  unitCode: string | null;
  unitPrice: string | null;
  netAmount: string | null;
  taxCategory: string | null;
  taxRate: string | null;
};

/**
 * The supplier postal address as the document carried it. Every field is
 * filled by the parser; nothing here is normalized or looked up, so a
 * consumer that also holds registry or message-listing metadata (a raw VAT
 * id, an emitter CUI from a message listing) keeps that on its own type
 * rather than expecting the parser to invent it.
 */
export type ReceivedSupplierAddress = {
  street: string | null;
  city: string | null;
  county: string | null;
  postalZone: string | null;
  countryCode: string | null;
};

export type ReceivedInvoice = {
  /** Which standard the ROOT element selected — diagnostic, not business data. */
  documentStandard: 'ubl' | 'cii';
  /**
   * Business semantics: "invoice" (380 or absent), "credit_note" (every
   * CreditNote ROOT, and 381 on an Invoice root), "corrective" (384 — a
   * storno/corrective that references the original invoice), or the raw type
   * code verbatim when an Invoice root carries none of those — never a guess.
   */
  documentKind: string;
  /**
   * The raw `CreditNoteTypeCode` when a CreditNote root carries one other
   * than 381, so a caller can LOG the code `documentKind` flattens away. It
   * is not a defect: a 261 or 396 credit note is a perfectly good document.
   */
  creditNoteTypeCode: string | null;
  /**
   * ANAF's PDF converter standard, chosen by the ROOT element: a CreditNote
   * document converts as FCN, everything else as FACT1.
   */
  pdfStandard: 'FACT1' | 'FCN';
  /** The referenced original invoice id on correctives/credit notes. */
  billingReference: string | null;
  invoiceNumber: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currencyCode: string | null;
  supplierName: string | null;
  supplierVatCode: string | null;
  supplierAddress: ReceivedSupplierAddress;
  /**
   * Decimal strings, never numbers — exact decimals all the way through.
   * Published digits are preserved; only the sign and an empty integer or
   * fraction part are normalised (see `ReceivedInvoiceLine.quantity`).
   */
  subtotalAmount: string | null;
  taxAmount: string | null;
  totalAmount: string | null;
  sourceLines: ReceivedInvoiceLine[];
  /** Human-visible notes for malformed or absent line facts. */
  sourceLineDiagnostics: string[];
};

type XmlObject = Record<string, unknown>;

// Matches ANAF's own per-document ceiling: it accepts invoice XML up to
// ~10 MB (attachments embedded base64), plus headroom. Counted in BYTES,
// not code units: a document of diacritics or embedded base64 costs more
// memory than its `.length` suggests.
const MAX_XML_BYTES = 12 * 1024 * 1024;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * The full XSD `decimal` lexical space, which is what UBL and CII declare
 * their amount types as: an optional sign, and digits with the integer part,
 * the fractional part, or neither omitted (`119.00`, `+119.00`, `.5`, `5.`).
 * A stricter pattern silently nulled amounts from conformant documents.
 *
 * Deliberately NOT accepted: exponents (`1e3`), grouping separators (`1,5`),
 * whitespace inside the number, and anything with two decimal points — XSD
 * `decimal` excludes all of them, and guessing at them would invent digits.
 */
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const CURRENCY = /^[A-Z]{3}$/;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Supplier-authored XML: never expand entities — recursive definitions
  // ("billion laughs") would balloon memory inside a bulk sweep. References
  // stay literal text, which is honest for a header registry.
  processEntities: false,
});

const asArray = <T>(value: T | T[] | null | undefined): T[] =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

const objectOf = (value: unknown): XmlObject | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as XmlObject) : null;

const at = (value: unknown, ...path: string[]): unknown =>
  path.reduce<unknown>((current, key) => objectOf(current)?.[key], value);

const PREDEFINED_ENTITIES: Record<string, string> = {
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
};

/**
 * The five predefined entities plus decimal and hex character references.
 * Anything else — a DTD-declared or undefined entity such as `&nosuch;` —
 * is left alone on purpose.
 */
const CHARACTER_REFERENCE = /&(?:#x([0-9a-fA-F]+)|#(\d+)|lt|gt|quot|apos|amp);/g;

/** The largest scalar value a code point may carry. */
const MAX_CODE_POINT = 0x10ffff;

/**
 * A code point that `String.fromCodePoint` would reject, or that XML forbids
 * in character data: NUL, a lone surrogate, or anything past the Unicode
 * range. Such a reference stays literal text rather than throwing.
 */
const isUnusableCodePoint = (codePoint: number): boolean =>
  !Number.isInteger(codePoint) ||
  codePoint <= 0 ||
  codePoint > MAX_CODE_POINT ||
  (codePoint >= 0xd800 && codePoint <= 0xdfff);

/**
 * With `processEntities: false` the parser hands back the whole entity layer
 * untouched — not only "Alfa &amp; Beta SRL" but also the character
 * references Romanian suppliers use for diacritics ("S&#259;pt&#x103;mâna").
 * Decode exactly the predefined entities and character references here.
 *
 * ONE left-to-right scan, never a sequence of passes: a pass-per-entity
 * decoder re-reads its own output, so `&amp;lt;` would turn into "<" and
 * `&#38;amp;` into "&". Both are wrong — XML semantics decode exactly one
 * level, making those the literal texts "&lt;" and "&amp;". A single scan
 * resumes after each replacement, so nothing is decoded twice.
 *
 * General and DTD entity expansion stays disabled (supplier-authored input;
 * recursive definitions would balloon memory), so `&nosuch;` and a
 * `<!ENTITY>`-declared reference pass through verbatim.
 */
const decodePredefinedEntities = (value: string): string =>
  value.replace(CHARACTER_REFERENCE, (match, hex: string | undefined, decimal: string | undefined) => {
    if (hex === undefined && decimal === undefined) {
      return PREDEFINED_ENTITIES[match] ?? match;
    }
    const codePoint = hex === undefined ? Number.parseInt(decimal as string, 10) : Number.parseInt(hex, 16);
    return isUnusableCodePoint(codePoint) ? match : String.fromCodePoint(codePoint);
  });

const textOf = (value: unknown): string | null => {
  const scalar = objectOf(value)?.['#text'] ?? value;
  if (typeof scalar !== 'string') {
    return null;
  }
  const trimmed = scalar.trim();
  return trimmed.length > 0 ? decodePredefinedEntities(trimmed) : null;
};

const firstText = (...values: unknown[]): string | null => {
  for (const value of values) {
    const text = textOf(value);
    if (text !== null) {
      return text;
    }
  }
  return null;
};

const attributeOf = (value: unknown, name: string): string | null => textOf(objectOf(value)?.[`@_${name}`]);

const isCalendarDate = (value: string): boolean => {
  if (!DATE.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined || year === 0 || month < 1 || month > 12) {
    return false;
  }

  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= (daysInMonth[month - 1] ?? 0);
};

const dateOf = (value: unknown): string | null => {
  const text = textOf(value);
  return text !== null && isCalendarDate(text) ? text : null;
};

const ciiDateOf = (value: unknown): string | null => {
  const text = textOf(value);
  if (text === null || !/^\d{8}$/.test(text)) {
    return null;
  }
  const formatted = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return isCalendarDate(formatted) ? formatted : null;
};

const currencyOf = (value: unknown): string | null => {
  const currency = textOf(value)?.toUpperCase() ?? null;
  return currency !== null && CURRENCY.test(currency) ? currency : null;
};

/**
 * The canonical spelling of an XSD `decimal`, so consumers see one shape
 * whichever lexical form the supplier published: a leading `+` is dropped, an
 * empty integer part becomes `0` (`.5` → `0.5`), and a trailing `.` is
 * dropped (`5.` → `5`). A leading `-` is kept.
 *
 * Leading zeros and every fractional digit stay EXACTLY as published:
 * `007.50` remains `007.50`. Canonical zero-stripping would be cosmetic, and
 * the published digits are the record — the scale a supplier chose is
 * information a consumer may need to see.
 *
 * Returns null when the text is not a decimal at all, so callers keep
 * distinguishing "absent" from "malformed". Never returns a number.
 */
const canonicalDecimal = (text: string): string | null => {
  if (!DECIMAL.test(text)) {
    return null;
  }
  const negative = text.startsWith('-');
  const unsigned = text.startsWith('+') || negative ? text.slice(1) : text;
  const withInteger = unsigned.startsWith('.') ? `0${unsigned}` : unsigned;
  const trimmed = withInteger.endsWith('.') ? withInteger.slice(0, -1) : withInteger;
  return negative ? `-${trimmed}` : trimmed;
};

const amountOf = (value: unknown): string | null => {
  const amount = textOf(value);
  return amount === null ? null : canonicalDecimal(amount);
};

const sourceDecimalOf = (value: unknown, label: string, invalidFields: string[]): string | null => {
  const text = textOf(value);
  if (text === null) return null;
  const decimal = canonicalDecimal(text);
  if (decimal !== null) return decimal;
  invalidFields.push(label);
  return null;
};

const sourceLineDiagnostics = (line: ReceivedInvoiceLine, invalidFields: string[]): string | null => {
  const missing: string[] = [];
  if (line.name === null) missing.push('item name');
  if (line.quantity === null && !invalidFields.includes('quantity')) missing.push('quantity');
  if (line.unitCode === null) missing.push('unit');
  if (line.unitPrice === null && !invalidFields.includes('unit price')) {
    missing.push('unit price');
  }
  if (line.netAmount === null && !invalidFields.includes('net amount')) {
    missing.push('net amount');
  }
  if (line.taxCategory === null) missing.push('VAT category');
  if (
    line.taxCategory !== null &&
    line.taxCategory !== 'O' &&
    line.taxRate === null &&
    !invalidFields.includes('VAT rate')
  ) {
    missing.push('VAT rate');
  }

  const notes: string[] = [];
  if (missing.length > 0) notes.push(`missing required fields: ${missing.join(', ')}`);
  if (invalidFields.length > 0) {
    notes.push(`invalid decimal fields: ${invalidFields.join(', ')}`);
  }
  return notes.length > 0 ? `Source line ${line.sourceOrder} has ${notes.join('; ')}.` : null;
};

const finishSourceLines = (
  lines: ReceivedInvoiceLine[],
  diagnostics: string[]
): Pick<ReceivedInvoice, 'sourceLines' | 'sourceLineDiagnostics'> => ({
  sourceLines: lines,
  sourceLineDiagnostics: lines.length === 0 ? ['Source document has no invoice lines.'] : diagnostics,
});

const parseUblLines = (
  root: XmlObject,
  rootKind: 'invoice' | 'credit_note'
): Pick<ReceivedInvoice, 'sourceLines' | 'sourceLineDiagnostics'> => {
  const nodes = asArray(at(root, rootKind === 'credit_note' ? 'CreditNoteLine' : 'InvoiceLine'));
  const diagnostics: string[] = [];
  const lines = nodes.map((node, index): ReceivedInvoiceLine => {
    const item = at(node, 'Item');
    const quantityNode = at(node, rootKind === 'credit_note' ? 'CreditedQuantity' : 'InvoicedQuantity');
    const taxCategory = asArray(at(item, 'ClassifiedTaxCategory'))[0];
    const invalidFields: string[] = [];
    const line: ReceivedInvoiceLine = {
      sourceId: textOf(at(node, 'ID')),
      sourceOrder: index + 1,
      supplierItemCode: textOf(at(item, 'SellersItemIdentification', 'ID')),
      name: textOf(at(item, 'Name')),
      quantity: sourceDecimalOf(quantityNode, 'quantity', invalidFields),
      unitCode: attributeOf(quantityNode, 'unitCode'),
      unitPrice: sourceDecimalOf(at(node, 'Price', 'PriceAmount'), 'unit price', invalidFields),
      netAmount: sourceDecimalOf(at(node, 'LineExtensionAmount'), 'net amount', invalidFields),
      taxCategory: textOf(at(taxCategory, 'ID')),
      taxRate: sourceDecimalOf(at(taxCategory, 'Percent'), 'VAT rate', invalidFields),
    };
    const diagnostic = sourceLineDiagnostics(line, invalidFields);
    if (diagnostic !== null) diagnostics.push(diagnostic);
    return line;
  });
  return finishSourceLines(lines, diagnostics);
};

const parseCiiLines = (transaction: unknown): Pick<ReceivedInvoice, 'sourceLines' | 'sourceLineDiagnostics'> => {
  const nodes = asArray(at(transaction, 'IncludedSupplyChainTradeLineItem'));
  const diagnostics: string[] = [];
  const lines = nodes.map((node, index): ReceivedInvoiceLine => {
    const product = at(node, 'SpecifiedTradeProduct');
    const quantityNode = at(node, 'SpecifiedLineTradeDelivery', 'BilledQuantity');
    const settlement = at(node, 'SpecifiedLineTradeSettlement');
    const tax = asArray(at(settlement, 'ApplicableTradeTax'))[0];
    const invalidFields: string[] = [];
    const line: ReceivedInvoiceLine = {
      sourceId: textOf(at(node, 'AssociatedDocumentLineDocument', 'LineID')),
      sourceOrder: index + 1,
      supplierItemCode: textOf(at(product, 'SellerAssignedID')),
      name: textOf(at(product, 'Name')),
      quantity: sourceDecimalOf(quantityNode, 'quantity', invalidFields),
      unitCode: attributeOf(quantityNode, 'unitCode'),
      unitPrice: sourceDecimalOf(
        at(node, 'SpecifiedLineTradeAgreement', 'NetPriceProductTradePrice', 'ChargeAmount'),
        'unit price',
        invalidFields
      ),
      netAmount: sourceDecimalOf(
        at(settlement, 'SpecifiedTradeSettlementLineMonetarySummation', 'LineTotalAmount'),
        'net amount',
        invalidFields
      ),
      taxCategory: textOf(at(tax, 'CategoryCode')),
      taxRate: sourceDecimalOf(at(tax, 'RateApplicablePercent'), 'VAT rate', invalidFields),
    };
    const diagnostic = sourceLineDiagnostics(line, invalidFields);
    if (diagnostic !== null) diagnostics.push(diagnostic);
    return line;
  });
  return finishSourceLines(lines, diagnostics);
};

const selectTaxAmount = (amountNodes: unknown[], currencyCode: string | null): string | null => {
  if (amountNodes.length === 0) {
    return null;
  }
  if (amountNodes.length === 1) {
    return amountOf(amountNodes[0]);
  }

  const matches =
    currencyCode === null
      ? []
      : amountNodes.filter((node) => attributeOf(node, 'currencyID')?.toUpperCase() === currencyCode);
  if (matches.length === 1) {
    return amountOf(matches[0]);
  }

  throw new AnafAmbiguousTaxTotalError(
    `Ambiguous VAT total: ${amountNodes.length} tax totals, none uniquely matching document currency ${
      currencyCode ?? 'unknown'
    }`
  );
};

/**
 * UN/CEFACT 1001 subset e-Factura actually uses: 380 commercial invoice,
 * 381 credit note, 384 corrected invoice. On an `<Invoice>` root anything
 * else is kept verbatim so an unexpected code is visible instead of
 * silently bucketed.
 *
 * A `<CreditNote>` ROOT is always a credit note, whatever its type code:
 * RO_CIUS practically restricts it to 381, but 261 (self-billed) and 396
 * (factored) credit notes reverse value exactly the same way, and a raw code
 * reaching a downstream ledger makes it refuse the document outright.
 */
const documentKindOf = (rootKind: 'invoice' | 'credit_note', typeCode: string | null): string => {
  if (rootKind === 'credit_note') return 'credit_note';
  if (typeCode === null) return rootKind;
  if (typeCode === '380') return 'invoice';
  if (typeCode === '381') return 'credit_note';
  if (typeCode === '384') return 'corrective';
  return typeCode;
};

/** The flattened code, for a caller's log line — 381 is the expected one. */
const creditNoteTypeCodeOf = (rootKind: 'invoice' | 'credit_note', typeCode: string | null): string | null =>
  rootKind === 'credit_note' && typeCode !== null && typeCode !== '381' ? typeCode : null;

const parseUbl = (root: XmlObject, rootKind: 'invoice' | 'credit_note'): ReceivedInvoice => {
  const supplierParty = at(root, 'AccountingSupplierParty', 'Party');
  const supplierAddress = at(supplierParty, 'PostalAddress');
  const partyTaxSchemes = asArray(at(supplierParty, 'PartyTaxScheme'));
  const vatTaxScheme = partyTaxSchemes.find((scheme) => textOf(at(scheme, 'TaxScheme', 'ID'))?.toUpperCase() === 'VAT');
  const currencyCode = currencyOf(at(root, 'DocumentCurrencyCode'));
  const taxAmountNodes = asArray(at(root, 'TaxTotal')).map((total) => at(total, 'TaxAmount'));
  const typeCode = textOf(at(root, rootKind === 'credit_note' ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'));

  return {
    documentStandard: 'ubl',
    documentKind: documentKindOf(rootKind, typeCode),
    creditNoteTypeCode: creditNoteTypeCodeOf(rootKind, typeCode),
    pdfStandard: rootKind === 'credit_note' ? 'FCN' : 'FACT1',
    billingReference: textOf(at(asArray(at(root, 'BillingReference'))[0], 'InvoiceDocumentReference', 'ID')),
    invoiceNumber: textOf(at(root, 'ID')),
    issueDate: dateOf(at(root, 'IssueDate')),
    dueDate: dateOf(at(root, 'DueDate')),
    currencyCode,
    supplierName: firstText(
      at(supplierParty, 'PartyLegalEntity', 'RegistrationName'),
      at(supplierParty, 'PartyName', 'Name')
    ),
    supplierVatCode:
      textOf(at(vatTaxScheme, 'CompanyID')) ?? textOf(at(supplierParty, 'PartyLegalEntity', 'CompanyID')),
    supplierAddress: {
      street: textOf(at(supplierAddress, 'StreetName')),
      city: textOf(at(supplierAddress, 'CityName')),
      county: textOf(at(supplierAddress, 'CountrySubentity')),
      postalZone: textOf(at(supplierAddress, 'PostalZone')),
      countryCode: textOf(at(supplierAddress, 'Country', 'IdentificationCode')),
    },
    subtotalAmount: amountOf(at(root, 'LegalMonetaryTotal', 'TaxExclusiveAmount')),
    taxAmount: selectTaxAmount(taxAmountNodes, currencyCode),
    totalAmount: amountOf(at(root, 'LegalMonetaryTotal', 'TaxInclusiveAmount')),
    ...parseUblLines(root, rootKind),
  };
};

const parseCii = (root: XmlObject): ReceivedInvoice => {
  const transaction = at(root, 'SupplyChainTradeTransaction');
  const settlement = at(transaction, 'ApplicableHeaderTradeSettlement');
  const seller = at(transaction, 'ApplicableHeaderTradeAgreement', 'SellerTradeParty');
  const supplierAddress = at(seller, 'PostalTradeAddress');
  const summation = at(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation');
  const currencyCode = currencyOf(at(settlement, 'InvoiceCurrencyCode'));
  const vatRegistration = asArray(at(seller, 'SpecifiedTaxRegistration')).find(
    (registration) => attributeOf(at(registration, 'ID'), 'schemeID') === 'VA'
  );

  return {
    documentStandard: 'cii',
    documentKind: documentKindOf('invoice', textOf(at(root, 'ExchangedDocument', 'TypeCode'))),
    // CII has no CreditNote root — nothing gets flattened.
    creditNoteTypeCode: null,
    pdfStandard: 'FACT1',
    billingReference: textOf(at(settlement, 'InvoiceReferencedDocument', 'IssuerAssignedID')),
    invoiceNumber: textOf(at(root, 'ExchangedDocument', 'ID')),
    issueDate: ciiDateOf(at(root, 'ExchangedDocument', 'IssueDateTime', 'DateTimeString')),
    dueDate: ciiDateOf(at(settlement, 'SpecifiedTradePaymentTerms', 'DueDateDateTime', 'DateTimeString')),
    currencyCode,
    supplierName: textOf(at(seller, 'Name')),
    supplierVatCode: textOf(at(vatRegistration, 'ID')),
    supplierAddress: {
      street: textOf(at(supplierAddress, 'LineOne')),
      city: textOf(at(supplierAddress, 'CityName')),
      county: textOf(at(supplierAddress, 'CountrySubDivisionName')),
      postalZone: textOf(at(supplierAddress, 'PostcodeCode')),
      countryCode: textOf(at(supplierAddress, 'CountryID')),
    },
    subtotalAmount: amountOf(at(summation, 'TaxBasisTotalAmount')),
    taxAmount: selectTaxAmount(asArray(at(summation, 'TaxTotalAmount')), currencyCode),
    totalAmount: amountOf(at(summation, 'GrandTotalAmount')),
    ...parseCiiLines(transaction),
  };
};

/**
 * `XMLValidator` accepts documents the parser then refuses, so the parse call
 * has its own failure mode: it throws a bare `Error` for an external entity
 * declaration (`<!ENTITY x SYSTEM ...>`, even an unreferenced one) and for a
 * reserved element name such as `__proto__` or `constructor`. Both are
 * legitimate refusals, but a bare `Error` reaching a caller is
 * indistinguishable from a bug, so they are rethrown as the SDK's own type.
 *
 * `AnafXmlParsingError` predates `Error.cause` and takes no options bag, so
 * the original wording is appended instead of chained. The XML itself is
 * never attached: these messages carry element names at most, never document
 * content.
 */
const parseXml = (xml: string): unknown => {
  try {
    return parser.parse(xml);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new AnafXmlParsingError(`Received document could not be parsed: ${reason}`);
  }
};

/**
 * Parse a received e-Factura document (UBL 2.1 `Invoice`/`CreditNote` or CII
 * `CrossIndustryInvoice`) into a flat header plus its source lines.
 *
 * @param xml The document XML exactly as ANAF delivered it.
 * @returns The parsed header; every amount is a decimal string or null.
 * @throws {AnafValidationError} The document exceeds the size guard, or its
 *   root element is not a supported invoice root.
 * @throws {AnafXmlParsingError} The document is not well-formed XML, declares
 *   an external entity, or names an element with a reserved JavaScript
 *   property name.
 * @throws {AnafAmbiguousTaxTotalError} The document carries several VAT
 *   totals and none of them uniquely matches the document currency.
 */
export function parseReceivedInvoice(xml: string): ReceivedInvoice {
  if (Buffer.byteLength(xml, 'utf8') > MAX_XML_BYTES) {
    throw new AnafValidationError('Received document is too large to parse');
  }

  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new AnafXmlParsingError(`Received document is not well-formed XML: ${validation.err.msg}`);
  }

  const parsed = objectOf(parseXml(xml));
  if (parsed === null) {
    throw new AnafValidationError('Unsupported document root: unknown');
  }

  const invoice = objectOf(parsed.Invoice);
  if (invoice !== null) {
    return parseUbl(invoice, 'invoice');
  }

  const creditNote = objectOf(parsed.CreditNote);
  if (creditNote !== null) {
    return parseUbl(creditNote, 'credit_note');
  }

  const cii = objectOf(parsed.CrossIndustryInvoice);
  if (cii !== null) {
    return parseCii(cii);
  }

  const root = Object.keys(parsed).find((key) => !key.startsWith('?')) ?? 'unknown';
  throw new AnafValidationError(`Unsupported document root: ${root}`);
}
