import { create } from 'xmlbuilder2';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces'; // For v3.1.1
import {
  InvoiceInput,
  InvoiceLine,
  Party,
  Address,
  DocumentAllowanceCharge,
  UblInvoiceInput, // Legacy compatibility
} from '../types';
import {
  UBL_CUSTOMIZATION_ID,
  INVOICE_TYPE_CODE,
  DEFAULT_CURRENCY,
  DEFAULT_COUNTRY_CODE,
  DEFAULT_UNIT_CODE,
} from '../constants';
import { formatDateForAnaf } from '../utils/dateUtils';
import { AnafValidationError } from '../errors';

/**
 * Enhanced UBL 2.1 Invoice Builder for ANAF e-Factura
 *
 * Generates UBL 2.1 XML invoices compliant with Romanian CIUS-RO specification.
 * Supports multiple VAT rates, detailed validation, and comprehensive error handling.
 */

interface TaxGroup {
  categoryId: string;
  percent: number;
  taxableAmount: number;
  taxAmount: number;
  exemptionReasonCode?: string;
}

/**
 * Build party XML structure for supplier or customer
 *
 * Element ordering follows UBL 2.1 / CIUS-RO schema sequence:
 * PartyIdentification → PartyName → PostalAddress → PartyTaxScheme → PartyLegalEntity → Contact
 *
 * @param root XML root element
 * @param tagName Tag name (cac:AccountingSupplierParty or cac:AccountingCustomerParty)
 * @param party Party information
 * @param isSupplierVatPayer Whether the invoice's supplier is VAT-registered. When false, all
 *   lines fall under tax category 'O' and CIUS-RO BR-O-02 forbids any VAT id on either party
 *   (Seller VAT id BT-31, tax representative VAT id BT-63, Buyer VAT id BT-48). PartyTaxScheme
 *   is therefore omitted for both supplier and customer in that case.
 */
function buildPartyXml(root: XMLBuilder, tagName: string, party: Party, isSupplierVatPayer: boolean): void {
  const partyElement = root.ele(tagName).ele('cac:Party');
  const address = party.address;

  // Party Identification (optional supplementary ID)
  if (party.partyIdentificationId) {
    partyElement.ele('cac:PartyIdentification').ele('cbc:ID').txt(party.partyIdentificationId).up().up();
  }

  // Party Name
  partyElement.ele('cac:PartyName').ele('cbc:Name').txt(party.registrationName).up().up();

  // Postal Address
  const postalAddress = partyElement
    .ele('cac:PostalAddress')
    .ele('cbc:StreetName')
    .txt(address.street || '')
    .up()
    .ele('cbc:CityName')
    .txt(address.city || '')
    .up()
    .ele('cbc:PostalZone')
    .txt(address.postalZone || '')
    .up();

  // Only emit CountrySubentity when a valid county code is provided.
  // An empty element triggers BR-RO-110/111 warnings from ANAF.
  if (address.county?.trim()) {
    postalAddress.ele('cbc:CountrySubentity').txt(address.county).up();
  }

  postalAddress
    .ele('cac:Country')
    .ele('cbc:IdentificationCode')
    .txt(address.countryCode || DEFAULT_COUNTRY_CODE)
    .up()
    .up()
    .up();

  // Party Tax Scheme (if VAT number provided) — must come before PartyLegalEntity.
  // BR-O-02: when the supplier is non-VAT (all lines are category 'O'), neither the
  // seller VAT id (BT-31) nor the buyer VAT id (BT-48) may be present.
  if (party.vatNumber && isSupplierVatPayer) {
    partyElement
      .ele('cac:PartyTaxScheme')
      .ele('cbc:CompanyID')
      .txt(party.vatNumber)
      .up()
      .ele('cac:TaxScheme')
      .ele('cbc:ID')
      .txt('VAT')
      .up()
      .up()
      .up();
  }

  // Party Legal Entity
  partyElement
    .ele('cac:PartyLegalEntity')
    .ele('cbc:RegistrationName')
    .txt(party.registrationName)
    .up()
    .ele('cbc:CompanyID')
    .txt(party.companyId)
    .up()
    .up();

  // Contact (optional)
  if (party.email || party.telephone) {
    const contactElement = partyElement.ele('cac:Contact');
    if (party.telephone) {
      contactElement.ele('cbc:Telephone').txt(party.telephone).up();
    }
    if (party.email) {
      contactElement.ele('cbc:ElectronicMail').txt(party.email).up();
    }
    contactElement.up();
  }
}

/**
 * Calculate line extension amount
 * @param line Invoice line
 * @returns Rounded line extension amount
 */
function calculateLineExtension(line: InvoiceLine): number {
  // Round unit price first to ensure consistent calculations
  const roundedUnitPrice = parseFloat(line.unitPrice.toFixed(2));
  return parseFloat((line.quantity * roundedUnitPrice).toFixed(2));
}

/**
 * Group lines by tax percentage for proper tax calculation
 * @param lines Invoice lines
 * @param isSupplierVatPayer Whether supplier is VAT registered
 * @returns Tax groups array
 */
function groupLinesByTax(lines: InvoiceLine[], isSupplierVatPayer: boolean): TaxGroup[] {
  const taxGroups = new Map<string, TaxGroup>();

  lines.forEach((line) => {
    const taxPercent = line.taxPercent || 0;
    const lineExtension = calculateLineExtension(line);
    const taxAmount = parseFloat((lineExtension * (taxPercent / 100)).toFixed(2));

    // Determine tax category ID
    let categoryId: string;
    let exemptionReasonCode: string | undefined;

    if (!isSupplierVatPayer) {
      categoryId = 'O'; // Not subject to VAT
      exemptionReasonCode = 'VATEX-EU-O';
    } else if (taxPercent > 0) {
      categoryId = 'S'; // Standard rated
    } else {
      categoryId = 'Z'; // Zero rated
    }

    const key = `${categoryId}-${taxPercent}`;

    if (taxGroups.has(key)) {
      const group = taxGroups.get(key)!;
      group.taxableAmount = parseFloat((group.taxableAmount + lineExtension).toFixed(2));
      group.taxAmount = parseFloat((group.taxAmount + taxAmount).toFixed(2));
    } else {
      taxGroups.set(key, {
        categoryId,
        percent: taxPercent,
        taxableAmount: lineExtension,
        taxAmount,
        exemptionReasonCode,
      });
    }
  });

  return Array.from(taxGroups.values());
}

/**
 * Validate invoice input data
 * @param input Invoice input data
 * @throws {AnafValidationError} If validation fails
 */
function validateInvoiceInput(input: InvoiceInput): void {
  if (!input) {
    throw new AnafValidationError('Invoice input data is required');
  }

  if (!input.invoiceNumber?.trim()) {
    throw new AnafValidationError('Invoice number is required');
  }

  if (!input.issueDate) {
    throw new AnafValidationError('Issue date is required');
  }

  // Validate supplier
  if (!input.supplier) {
    throw new AnafValidationError('Supplier information is required');
  }
  validateParty(input.supplier, 'Supplier');

  // Validate customer
  if (!input.customer) {
    throw new AnafValidationError('Customer information is required');
  }
  validateParty(input.customer, 'Customer');

  // Validate lines - allow empty lines for testing purposes
  if (!input.lines) {
    throw new AnafValidationError('Invoice lines array is required');
  }

  // Only validate individual lines if there are any
  if (input.lines.length > 0) {
    input.lines.forEach((line, index) => validateLine(line, index));
  }

  // Validate document-level allowances/charges (shape only — tax-category
  // inheritance/resolution happens later, alongside tax-group computation).
  if (input.documentAllowanceCharges) {
    input.documentAllowanceCharges.forEach((ac, index) => validateDocumentAllowanceCharge(ac, index));
  }
}

/**
 * Validate party information
 * @param party Party to validate
 * @param role Party role (for error messages)
 */
function validateParty(party: Party, role: string): void {
  if (!party.registrationName?.trim()) {
    throw new AnafValidationError(`${role} registration name is required`);
  }

  if (!party.companyId?.trim()) {
    throw new AnafValidationError(`${role} company ID is required`);
  }

  if (!party.address) {
    throw new AnafValidationError(`${role} address is required`);
  }

  validateAddress(party.address, role);
}

/**
 * Validate address information
 * @param address Address to validate
 * @param role Role for error messages
 */
function validateAddress(address: Address, role: string): void {
  if (!address.street?.trim()) {
    throw new AnafValidationError(`${role} street address is required`);
  }

  if (!address.city?.trim()) {
    throw new AnafValidationError(`${role} city is required`);
  }

  if (!address.postalZone?.trim()) {
    throw new AnafValidationError(`${role} postal zone is required`);
  }
}

/**
 * Validate invoice line
 * @param line Line to validate
 * @param index Line index for error messages
 */
function validateLine(line: InvoiceLine, index: number): void {
  if (!line.description?.trim()) {
    throw new AnafValidationError(`Line ${index + 1}: Description is required`);
  }

  if (typeof line.quantity !== 'number' || line.quantity <= 0) {
    throw new AnafValidationError(`Line ${index + 1}: Quantity must be a positive number`);
  }

  if (typeof line.unitPrice !== 'number' || line.unitPrice < 0) {
    throw new AnafValidationError(`Line ${index + 1}: Unit price must be a non-negative number`);
  }

  if (line.taxPercent !== undefined) {
    if (typeof line.taxPercent !== 'number' || line.taxPercent < 0 || line.taxPercent > 100) {
      throw new AnafValidationError(`Line ${index + 1}: Tax percent must be between 0 and 100`);
    }
  }
}

/**
 * Validate a document-level allowance/charge entry.
 *
 * Amount is always positive — the sign is conveyed by `chargeIndicator`, never by
 * a negative number. Tax-category resolution (inherit-from-lines vs. explicit) is
 * deferred to {@link resolveAllowanceTaxCategory} because it needs the computed
 * line tax groups.
 *
 * @throws {AnafValidationError} If the entry is malformed.
 */
function validateDocumentAllowanceCharge(ac: DocumentAllowanceCharge, index: number): void {
  const label = `Allowance/Charge ${index + 1}`;

  if (typeof ac.chargeIndicator !== 'boolean') {
    throw new AnafValidationError(`${label}: chargeIndicator must be a boolean`);
  }

  if (typeof ac.amount !== 'number' || !Number.isFinite(ac.amount) || ac.amount <= 0) {
    throw new AnafValidationError(`${label}: amount must be a positive number (sign is carried by chargeIndicator)`);
  }

  if (!ac.reason || typeof ac.reason !== 'string' || !ac.reason.trim()) {
    throw new AnafValidationError(`${label}: reason is required`);
  }

  if (ac.taxPercent !== undefined) {
    if (typeof ac.taxPercent !== 'number' || ac.taxPercent < 0 || ac.taxPercent > 100) {
      throw new AnafValidationError(`${label}: taxPercent must be between 0 and 100`);
    }
  }
}

/**
 * Resolved tax-category metadata for a document-level allowance or charge.
 */
interface ResolvedAllowanceTaxCategory {
  categoryId: string;
  /** Undefined when categoryId === 'O' (BR-O-05 forbids cbc:Percent). */
  percent?: number;
  exemptionReasonCode?: string;
}

/**
 * Resolve the tax category for a document-level allowance/charge.
 *
 * Resolution order:
 *  1. If both `taxCategoryId` and `taxPercent` are explicit on the allowance, use them.
 *  2. If `taxCategoryId` is explicit but `taxPercent` is missing, infer the percent from
 *     the matching line tax group (or default to 0 for 'Z'/'O', error if 'S' has no match).
 *  3. If neither is explicit and the lines have a single tax group, inherit from it.
 *  4. Otherwise (lines have mixed tax groups), throw — caller must disambiguate.
 *
 * @throws {AnafValidationError} If lines have mixed tax categories and the allowance
 *   does not specify `taxCategoryId`, or if an explicit `taxCategoryId` references
 *   a standard-rated ('S') category with no matching line group to infer the percent from.
 */
function resolveAllowanceTaxCategory(
  ac: DocumentAllowanceCharge,
  index: number,
  taxGroups: TaxGroup[],
  isSupplierVatPayer: boolean
): ResolvedAllowanceTaxCategory {
  const label = `Allowance/Charge ${index + 1}`;

  // If supplier is non-VAT, every allowance/charge must be category 'O' too —
  // mirroring how every line gets coerced to 'O' in groupLinesByTax.
  if (!isSupplierVatPayer) {
    if (ac.taxCategoryId && ac.taxCategoryId !== 'O') {
      throw new AnafValidationError(
        `${label}: taxCategoryId must be 'O' when supplier is not VAT-registered, got '${ac.taxCategoryId}'`
      );
    }
    return { categoryId: 'O', exemptionReasonCode: 'VATEX-EU-O' };
  }

  // Explicit category provided.
  if (ac.taxCategoryId) {
    const matching = taxGroups.find((g) => g.categoryId === ac.taxCategoryId);
    let percent: number;
    if (ac.taxPercent !== undefined) {
      percent = ac.taxPercent;
    } else if (matching) {
      percent = matching.percent;
    } else if (ac.taxCategoryId === 'Z') {
      percent = 0;
    } else {
      throw new AnafValidationError(
        `${label}: taxPercent is required when taxCategoryId='${ac.taxCategoryId}' does not match any line tax category`
      );
    }
    // BR-O-05: category 'O' must not carry cbc:Percent.
    if (ac.taxCategoryId === 'O') {
      return { categoryId: 'O', exemptionReasonCode: matching?.exemptionReasonCode ?? 'VATEX-EU-O' };
    }
    return { categoryId: ac.taxCategoryId, percent, exemptionReasonCode: matching?.exemptionReasonCode };
  }

  // Inherit from lines.
  if (taxGroups.length === 0) {
    throw new AnafValidationError(`${label}: taxCategoryId is required when the invoice has no lines to inherit from`);
  }
  if (taxGroups.length > 1) {
    const categories = taxGroups.map((g) => g.categoryId).join(', ');
    throw new AnafValidationError(
      `${label}: taxCategoryId is required because invoice lines have mixed tax categories (${categories})`
    );
  }

  const onlyGroup = taxGroups[0];
  return {
    categoryId: onlyGroup.categoryId,
    percent: onlyGroup.categoryId === 'O' ? undefined : (ac.taxPercent ?? onlyGroup.percent),
    exemptionReasonCode: onlyGroup.exemptionReasonCode,
  };
}

/**
 * Apply resolved document-level allowances/charges to the per-category tax groups.
 *
 * For each allowance (`chargeIndicator=false`), the matching group's `taxableAmount`
 * is decreased; for each charge (`chargeIndicator=true`), it is increased. The
 * group's `taxAmount` is then re-derived from the adjusted taxable amount and the
 * group's percent. This satisfies CIUS-RO BR-CO-17 / BR-DEC-19, where each
 * `cac:TaxSubtotal` reflects the apportioned base after document-level adjustments.
 *
 * Returns a new array; the input array is not mutated.
 */
function applyAllowancesToTaxGroups(
  taxGroups: TaxGroup[],
  resolvedAllowances: Array<{ ac: DocumentAllowanceCharge; resolved: ResolvedAllowanceTaxCategory }>
): TaxGroup[] {
  if (resolvedAllowances.length === 0) {
    return taxGroups;
  }

  // Clone so we don't mutate the caller's groups.
  const groupsByCategory = new Map<string, TaxGroup>();
  taxGroups.forEach((g) => groupsByCategory.set(g.categoryId, { ...g }));

  resolvedAllowances.forEach(({ ac, resolved }) => {
    let group = groupsByCategory.get(resolved.categoryId);
    if (!group) {
      // No line was rated at this category — create an empty group so the
      // adjustment still appears in the VAT breakdown.
      group = {
        categoryId: resolved.categoryId,
        percent: resolved.percent ?? 0,
        taxableAmount: 0,
        taxAmount: 0,
        exemptionReasonCode: resolved.exemptionReasonCode,
      };
      groupsByCategory.set(resolved.categoryId, group);
    }

    const delta = ac.chargeIndicator ? ac.amount : -ac.amount;
    group.taxableAmount = parseFloat((group.taxableAmount + delta).toFixed(2));
  });

  // Re-derive taxAmount from the adjusted taxableAmount, except for category 'O'
  // (not subject to VAT) which always has taxAmount = 0 and no percent.
  groupsByCategory.forEach((group) => {
    if (group.categoryId === 'O') {
      group.taxAmount = 0;
    } else {
      group.taxAmount = parseFloat((group.taxableAmount * (group.percent / 100)).toFixed(2));
    }
  });

  return Array.from(groupsByCategory.values());
}

/**
 * Build comprehensive UBL 2.1 Invoice XML
 *
 * This function creates a complete UBL 2.1 XML invoice that complies with
 * the Romanian CIUS-RO specification for ANAF e-Factura.
 *
 * @param input Invoice data
 * @returns UBL XML string
 * @throws {AnafValidationError} If input data is invalid
 *
 * @example
 * ```typescript
 * const xml = buildInvoiceXml({
 *   invoiceNumber: 'INV-2024-001',
 *   issueDate: new Date(),
 *   supplier: {
 *     registrationName: 'Furnizor SRL',
 *     companyId: 'RO12345678',
 *     vatNumber: 'RO12345678',
 *     address: {
 *       street: 'Str. Exemplu 1',
 *       city: 'București',
 *       postalZone: '010101'
 *     }
 *   },
 *   customer: {
 *     registrationName: 'Client SRL',
 *     companyId: 'RO87654321',
 *     address: {
 *       street: 'Str. Client 2',
 *       city: 'Cluj-Napoca',
 *       postalZone: '400001'
 *     }
 *   },
 *   lines: [
 *     {
 *       description: 'Produs/Serviciu',
 *       quantity: 1,
 *       unitPrice: 100,
 *       taxPercent: 19
 *     }
 *   ],
 *   isSupplierVatPayer: true
 * });
 * ```
 */
export function buildInvoiceXml(input: InvoiceInput): string {
  // Validate input
  validateInvoiceInput(input);

  // Set defaults
  const currency = input.currency || DEFAULT_CURRENCY;
  const isSupplierVatPayer = input.isSupplierVatPayer ?? !!input.supplier.vatNumber;

  // Format dates
  const issueDate = formatDateForAnaf(input.issueDate);
  const dueDate = input.dueDate ? formatDateForAnaf(input.dueDate) : issueDate;

  // Calculate tax groups from lines only — the sum of these taxableAmounts is
  // BT-106 LineExtensionAmount, which is unaffected by document-level allowances.
  const lineTaxGroups = input.lines.length > 0 ? groupLinesByTax(input.lines, isSupplierVatPayer) : [];
  const lineExtensionAmount = parseFloat(lineTaxGroups.reduce((sum, group) => sum + group.taxableAmount, 0).toFixed(2));

  // Resolve document-level allowance/charge tax categories now that we know the
  // line tax groups. This either inherits or validates the explicit categoryId
  // against the lines' groups.
  const allowances = input.documentAllowanceCharges ?? [];
  const resolvedAllowances = allowances.map((ac, index) => ({
    ac,
    resolved: resolveAllowanceTaxCategory(ac, index, lineTaxGroups, isSupplierVatPayer),
  }));

  // BT-107 AllowanceTotalAmount and BT-108 ChargeTotalAmount — summed across all
  // document-level allowances/charges, irrespective of tax category.
  const allowanceTotalAmount = parseFloat(
    resolvedAllowances
      .filter(({ ac }) => !ac.chargeIndicator)
      .reduce((sum, { ac }) => sum + ac.amount, 0)
      .toFixed(2)
  );
  const chargeTotalAmount = parseFloat(
    resolvedAllowances
      .filter(({ ac }) => ac.chargeIndicator)
      .reduce((sum, { ac }) => sum + ac.amount, 0)
      .toFixed(2)
  );

  // Apply allowances/charges to the per-category tax groups so cac:TaxSubtotal
  // reflects the post-adjustment base (BR-CO-17 / BR-DEC-19).
  const taxGroups = applyAllowancesToTaxGroups(lineTaxGroups, resolvedAllowances);
  const totalTaxableAmount = parseFloat(taxGroups.reduce((sum, group) => sum + group.taxableAmount, 0).toFixed(2));
  const totalTaxAmount = parseFloat(taxGroups.reduce((sum, group) => sum + group.taxAmount, 0).toFixed(2));
  // BT-109 TaxExclusiveAmount = LineExtension − AllowanceTotal + ChargeTotal.
  // Equivalent to the post-adjustment sum of group taxable amounts; we compute it
  // explicitly so the equality is auditable and resilient to floating-point drift.
  const taxExclusiveAmount = parseFloat((lineExtensionAmount - allowanceTotalAmount + chargeTotalAmount).toFixed(2));
  // BT-112 TaxInclusiveAmount = TaxExclusive + TaxAmount.
  const grandTotal = parseFloat((taxExclusiveAmount + totalTaxAmount).toFixed(2));

  // Create XML document
  const root = create({ version: '1.0', encoding: 'UTF-8' }).ele('Invoice', {
    xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
    'xmlns:cbc': 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
    'xmlns:cac': 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
  });

  // Invoice header — element ordering follows UBL 2.1 schema
  root
    .ele('cbc:UBLVersionID')
    .txt('2.1')
    .up()
    .ele('cbc:CustomizationID')
    .txt(UBL_CUSTOMIZATION_ID)
    .up()
    .ele('cbc:ID')
    .txt(input.invoiceNumber)
    .up()
    .ele('cbc:IssueDate')
    .txt(issueDate)
    .up()
    .ele('cbc:DueDate')
    .txt(dueDate)
    .up()
    .ele('cbc:InvoiceTypeCode')
    .txt(INVOICE_TYPE_CODE)
    .up();

  // Note (optional)
  if (input.note) {
    root.ele('cbc:Note').txt(input.note).up();
  }

  root.ele('cbc:DocumentCurrencyCode').txt(currency).up();

  // BR-RO-030: when invoice currency is not RON, VAT must be accounted in RON
  if (currency !== 'RON') {
    root.ele('cbc:TaxCurrencyCode').txt('RON').up();
  }

  // Invoice Period (optional)
  if (input.invoicePeriodEndDate) {
    const periodEndDate = formatDateForAnaf(input.invoicePeriodEndDate);
    root.ele('cac:InvoicePeriod').ele('cbc:EndDate').txt(periodEndDate).up().up();
  }

  // Parties
  buildPartyXml(root, 'cac:AccountingSupplierParty', input.supplier, isSupplierVatPayer);
  buildPartyXml(root, 'cac:AccountingCustomerParty', input.customer, isSupplierVatPayer);

  // Payment means — emitted when either a means code or an IBAN is provided.
  //
  // Backwards compatibility: when only `paymentIban` is set, defaults to UN/ECE 4461
  // code '31' (SEPA Credit Transfer) — the original hardcoded behaviour.
  //
  // Callers can pass `paymentMeansCode` (e.g. '10' cash, '48' bank card) to declare
  // payments that already happened; in that case `paymentIban` is typically omitted
  // and no `<cac:PayeeFinancialAccount>` is emitted.
  if (input.paymentMeansCode || input.paymentIban) {
    const paymentMeansElement = root
      .ele('cac:PaymentMeans')
      .ele('cbc:PaymentMeansCode')
      .txt(input.paymentMeansCode ?? '31')
      .up();

    if (input.paymentIban) {
      paymentMeansElement.ele('cac:PayeeFinancialAccount').ele('cbc:ID').txt(input.paymentIban).up().up();
    }

    paymentMeansElement.up();
  }

  // Document-level AllowanceCharge entries — emitted after PaymentMeans and before
  // TaxTotal, per UBL 2.1 schema ordering. Each entry carries a TaxCategory so the
  // ANAF schematron (BR-CO-17, BR-DEC-19) can apportion the adjustment to the
  // matching tax subtotal.
  resolvedAllowances.forEach(({ ac, resolved }) => {
    const reasonCode = ac.reasonCode ?? (ac.chargeIndicator ? 'ZZZ' : '95');

    const acElement = root
      .ele('cac:AllowanceCharge')
      .ele('cbc:ChargeIndicator')
      .txt(ac.chargeIndicator ? 'true' : 'false')
      .up()
      .ele('cbc:AllowanceChargeReasonCode')
      .txt(reasonCode)
      .up()
      .ele('cbc:AllowanceChargeReason')
      .txt(ac.reason)
      .up()
      .ele('cbc:Amount', { currencyID: currency })
      .txt(ac.amount.toFixed(2))
      .up();

    const taxCategoryElement = acElement.ele('cac:TaxCategory').ele('cbc:ID').txt(resolved.categoryId).up();

    // BR-O-05: category 'O' (Not subject to VAT) must not contain cbc:Percent.
    if (resolved.categoryId !== 'O' && resolved.percent !== undefined) {
      taxCategoryElement.ele('cbc:Percent').txt(resolved.percent.toFixed(2)).up();
    }

    if (resolved.exemptionReasonCode) {
      taxCategoryElement.ele('cbc:TaxExemptionReasonCode').txt(resolved.exemptionReasonCode).up();
    }

    taxCategoryElement.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT').up().up().up(); // close TaxCategory + AllowanceCharge
  });

  // Tax total with subtotals for each tax group
  const taxTotalElement = root
    .ele('cac:TaxTotal')
    .ele('cbc:TaxAmount', { currencyID: currency })
    .txt(totalTaxAmount.toFixed(2))
    .up();

  // Add tax subtotal for each tax group (if any)
  if (taxGroups.length > 0) {
    taxGroups.forEach((group) => {
      const taxCategoryElement = taxTotalElement
        .ele('cac:TaxSubtotal')
        .ele('cbc:TaxableAmount', { currencyID: currency })
        .txt(group.taxableAmount.toFixed(2))
        .up()
        .ele('cbc:TaxAmount', { currencyID: currency })
        .txt(group.taxAmount.toFixed(2))
        .up()
        .ele('cac:TaxCategory')
        .ele('cbc:ID')
        .txt(group.categoryId)
        .up();

      // BR-O-05: invoice line tax category 'O' (Not subject to VAT) must not contain BT-152 (Percent).
      if (group.categoryId !== 'O') {
        taxCategoryElement.ele('cbc:Percent').txt(group.percent.toFixed(2)).up();
      }

      // Add exemption reason for category O
      if (group.exemptionReasonCode) {
        taxCategoryElement.ele('cbc:TaxExemptionReasonCode').txt(group.exemptionReasonCode).up();
      }

      taxCategoryElement.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT').up().up().up(); // End TaxCategory and TaxSubtotal
    });
  } else {
    // Add a default tax subtotal for empty invoices
    taxTotalElement
      .ele('cac:TaxSubtotal')
      .ele('cbc:TaxableAmount', { currencyID: currency })
      .txt('0.00')
      .up()
      .ele('cbc:TaxAmount', { currencyID: currency })
      .txt('0.00')
      .up()
      .ele('cac:TaxCategory')
      .ele('cbc:ID')
      .txt('S')
      .up()
      .ele('cbc:Percent')
      .txt('0.00')
      .up()
      .ele('cac:TaxScheme')
      .ele('cbc:ID')
      .txt('VAT')
      .up()
      .up()
      .up()
      .up();
  }

  // BR-53: when TaxCurrencyCode (BT-6) is present, emit a second TaxTotal with the
  // accounting-currency tax amount (BT-111). No subtotals required for this element.
  if (currency !== 'RON' && input.taxCurrencyTaxAmount !== undefined) {
    root
      .ele('cac:TaxTotal')
      .ele('cbc:TaxAmount', { currencyID: 'RON' })
      .txt(input.taxCurrencyTaxAmount.toFixed(2))
      .up()
      .up();
  }

  // Legal monetary total.
  //
  // CIUS-RO BR-CO-25: PayableAmount = TaxInclusiveAmount − PrepaidAmount.
  // UBL 2.1 child ordering inside LegalMonetaryTotal:
  //   LineExtensionAmount → TaxExclusiveAmount → TaxInclusiveAmount →
  //   AllowanceTotalAmount → ChargeTotalAmount → PrepaidAmount →
  //   PayableRoundingAmount → PayableAmount.
  const prepaidAmount = input.prepaidAmount ?? 0;
  if (prepaidAmount < 0) {
    throw new AnafValidationError('Prepaid amount must be non-negative');
  }
  // Allow a 1-cent tolerance for floating-point rounding.
  if (prepaidAmount > grandTotal + 0.01) {
    throw new AnafValidationError(
      `Prepaid amount (${prepaidAmount.toFixed(2)}) cannot exceed the invoice grand total (${grandTotal.toFixed(2)})`
    );
  }
  // Clamp to 0 so the tolerance check above can't yield a negative PayableAmount
  // (e.g. grandTotal=119.00, prepaidAmount=119.005 → -0.01 before clamping).
  const payableAmount = Math.max(0, parseFloat((grandTotal - prepaidAmount).toFixed(2)));

  // BT-106 LineExtensionAmount is the sum of line nets (unchanged by document-level
  // allowances/charges). BT-109 TaxExclusiveAmount differs from LineExtensionAmount
  // whenever AllowanceTotalAmount or ChargeTotalAmount is non-zero.
  const legalMonetaryTotal = root
    .ele('cac:LegalMonetaryTotal')
    .ele('cbc:LineExtensionAmount', { currencyID: currency })
    .txt(lineExtensionAmount.toFixed(2))
    .up()
    .ele('cbc:TaxExclusiveAmount', { currencyID: currency })
    .txt(taxExclusiveAmount.toFixed(2))
    .up()
    .ele('cbc:TaxInclusiveAmount', { currencyID: currency })
    .txt(grandTotal.toFixed(2))
    .up();

  // BT-107 / BT-108 — emit only when non-zero, matching the conditional-emit
  // posture used elsewhere (e.g. PrepaidAmount).
  if (allowanceTotalAmount > 0) {
    legalMonetaryTotal
      .ele('cbc:AllowanceTotalAmount', { currencyID: currency })
      .txt(allowanceTotalAmount.toFixed(2))
      .up();
  }

  if (chargeTotalAmount > 0) {
    legalMonetaryTotal.ele('cbc:ChargeTotalAmount', { currencyID: currency }).txt(chargeTotalAmount.toFixed(2)).up();
  }

  if (prepaidAmount > 0) {
    legalMonetaryTotal.ele('cbc:PrepaidAmount', { currencyID: currency }).txt(prepaidAmount.toFixed(2)).up();
  }

  legalMonetaryTotal.ele('cbc:PayableAmount', { currencyID: currency }).txt(payableAmount.toFixed(2)).up().up();

  // Invoice lines
  input.lines.forEach((line, index) => {
    const lineId = line.id?.toString() || (index + 1).toString();
    const lineExtension = calculateLineExtension(line);
    const taxPercent = line.taxPercent || 0;
    const roundedUnitPrice = parseFloat(line.unitPrice.toFixed(2));

    // Determine tax category for this line
    let lineTaxCategory: string;
    if (!isSupplierVatPayer) {
      lineTaxCategory = 'O';
    } else if (taxPercent > 0) {
      lineTaxCategory = 'S';
    } else {
      lineTaxCategory = 'Z';
    }

    const classifiedTaxCategoryElement = root
      .ele('cac:InvoiceLine')
      .ele('cbc:ID')
      .txt(lineId)
      .up()
      .ele('cbc:InvoicedQuantity', { unitCode: line.unitCode || DEFAULT_UNIT_CODE })
      .txt(line.quantity.toString())
      .up()
      .ele('cbc:LineExtensionAmount', { currencyID: currency })
      .txt(lineExtension.toFixed(2))
      .up()
      .ele('cac:Item')
      .ele('cbc:Description')
      .txt(line.description)
      .up()
      .ele('cbc:Name')
      .txt(line.description)
      .up()
      .ele('cac:ClassifiedTaxCategory')
      .ele('cbc:ID')
      .txt(lineTaxCategory)
      .up();

    // BR-O-05: invoice line tax category 'O' (Not subject to VAT) must not contain BT-152 (Percent).
    if (lineTaxCategory !== 'O') {
      classifiedTaxCategoryElement.ele('cbc:Percent').txt(taxPercent.toFixed(2)).up();
    }

    classifiedTaxCategoryElement
      .ele('cac:TaxScheme')
      .ele('cbc:ID')
      .txt('VAT')
      .up()
      .up()
      .up()
      .up()
      .ele('cac:Price')
      .ele('cbc:PriceAmount', { currencyID: currency })
      .txt(roundedUnitPrice.toFixed(2))
      .up()
      .up()
      .up();
  });

  return root.end({ prettyPrint: true });
}

/**
 * Legacy compatibility function
 * @param input UBL invoice input (legacy format)
 * @returns UBL XML string
 * @deprecated Use buildInvoiceXml instead
 */
export function buildUblInvoiceXml(input: UblInvoiceInput): string {
  return buildInvoiceXml(input);
}
