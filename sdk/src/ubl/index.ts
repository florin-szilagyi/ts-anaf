/**
 * UBL (Universal Business Language) Module
 *
 * This module provides functionality for generating UBL 2.1 XML invoices
 * compliant with Romanian CIUS-RO specification for ANAF e-Factura.
 */

export { buildInvoiceXml, buildUblInvoiceXml } from './InvoiceBuilder';

// Romanian (CIUS-RO) party-mapping helpers
export {
  COUNTY_NAME_TO_ISO,
  countyFromAddress,
  bucharestSectorFromAddress,
  companyToParty,
  mergePartyOverride,
} from './roPartyMapping';
export type { PartyOverride as RoPartyOverride } from './roPartyMapping';

// Re-export types for convenience
export type {
  InvoiceInput,
  InvoiceLine,
  Party,
  Address,
  UblInvoiceInput,
  UblParty,
  UblAddress,
  UblInvoiceLine,
} from '../types';
