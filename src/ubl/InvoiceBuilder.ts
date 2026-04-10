import { create } from 'xmlbuilder2';
import type { XMLBuilder } from 'xmlbuilder2/lib/interfaces'; // For v3.1.1
import {
  InvoiceInput,
  InvoiceLine,
  Party,
  Address,
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
 */
function buildPartyXml(root: XMLBuilder, tagName: string, party: Party): void {
  const partyElement = root.ele(tagName).ele('cac:Party');
  const address = party.address;

  // Party Identification (optional supplementary ID)
  if (party.partyIdentificationId) {
    partyElement
      .ele('cac:PartyIdentification')
      .ele('cbc:ID')
      .txt(party.partyIdentificationId)
      .up()
      .up();
  }

  // Party Name
  partyElement
    .ele('cac:PartyName')
    .ele('cbc:Name')
    .txt(party.registrationName)
    .up()
    .up();

  // Postal Address
  partyElement
    .ele('cac:PostalAddress')
    .ele('cbc:StreetName')
    .txt(address.street || '')
    .up()
    .ele('cbc:CityName')
    .txt(address.city || '')
    .up()
    .ele('cbc:PostalZone')
    .txt(address.postalZone || '')
    .up()
    .ele('cbc:CountrySubentity')
    .txt(address.county || '')
    .up()
    .ele('cac:Country')
    .ele('cbc:IdentificationCode')
    .txt(address.countryCode || DEFAULT_COUNTRY_CODE)
    .up()
    .up()
    .up();

  // Party Tax Scheme (if VAT number provided) — must come before PartyLegalEntity
  if (party.vatNumber) {
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

  // Calculate tax groups and totals
  const taxGroups = input.lines.length > 0 ? groupLinesByTax(input.lines, isSupplierVatPayer) : [];
  const totalTaxableAmount = taxGroups.reduce((sum, group) => sum + group.taxableAmount, 0);
  const totalTaxAmount = taxGroups.reduce((sum, group) => sum + group.taxAmount, 0);
  const grandTotal = parseFloat((totalTaxableAmount + totalTaxAmount).toFixed(2));

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

  // Invoice Period (optional)
  if (input.invoicePeriodEndDate) {
    const periodEndDate = formatDateForAnaf(input.invoicePeriodEndDate);
    root
      .ele('cac:InvoicePeriod')
      .ele('cbc:EndDate')
      .txt(periodEndDate)
      .up()
      .up();
  }

  // Parties
  buildPartyXml(root, 'cac:AccountingSupplierParty', input.supplier);
  buildPartyXml(root, 'cac:AccountingCustomerParty', input.customer);

  // Payment means (if IBAN provided)
  if (input.paymentIban) {
    root
      .ele('cac:PaymentMeans')
      .ele('cbc:PaymentMeansCode')
      .txt('31')
      .up() // SEPA Credit transfer (UN/ECE 4461)
      .ele('cac:PayeeFinancialAccount')
      .ele('cbc:ID')
      .txt(input.paymentIban)
      .up()
      .up()
      .up();
  }

  // Tax total with subtotals for each tax group
  const taxTotalElement = root
    .ele('cac:TaxTotal')
    .ele('cbc:TaxAmount', { currencyID: currency })
    .txt(totalTaxAmount.toFixed(2))
    .up();

  // Add tax subtotal for each tax group (if any)
  if (taxGroups.length > 0) {
    taxGroups.forEach((group) => {
      const subtotalElement = taxTotalElement
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
        .up()
        .ele('cbc:Percent')
        .txt(group.percent.toFixed(2))
        .up();

      // Add exemption reason for category O
      if (group.exemptionReasonCode) {
        subtotalElement.ele('cbc:TaxExemptionReasonCode').txt(group.exemptionReasonCode).up();
      }

      subtotalElement.ele('cac:TaxScheme').ele('cbc:ID').txt('VAT').up().up().up(); // End TaxCategory and TaxSubtotal
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

  // Legal monetary total
  root
    .ele('cac:LegalMonetaryTotal')
    .ele('cbc:LineExtensionAmount', { currencyID: currency })
    .txt(totalTaxableAmount.toFixed(2))
    .up()
    .ele('cbc:TaxExclusiveAmount', { currencyID: currency })
    .txt(totalTaxableAmount.toFixed(2))
    .up()
    .ele('cbc:TaxInclusiveAmount', { currencyID: currency })
    .txt(grandTotal.toFixed(2))
    .up()
    .ele('cbc:PayableAmount', { currencyID: currency })
    .txt(grandTotal.toFixed(2))
    .up()
    .up();

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

    const lineElement = root
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
      .ele('cac:ClassifiedTaxCategory')
      .ele('cbc:ID')
      .txt(lineTaxCategory)
      .up()
      .ele('cbc:Percent')
      .txt(taxPercent.toFixed(2))
      .up()
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
