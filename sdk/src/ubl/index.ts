/**
 * UBL (Universal Business Language) Module
 *
 * This module provides functionality for generating UBL 2.1 XML invoices
 * compliant with Romanian CIUS-RO specification for ANAF e-Factura, and for
 * parsing received e-Factura documents (UBL 2.1 and CII).
 */

export { buildInvoiceXml, buildUblInvoiceXml } from './InvoiceBuilder';
export { parseReceivedInvoice } from './receivedInvoice';

export type { ReceivedInvoice, ReceivedInvoiceLine, ReceivedSupplierAddress } from './receivedInvoice';

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
