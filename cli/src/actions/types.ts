import type { InvoiceTypeCode } from '@florinszilagyi/anaf-ts-sdk';

export type ActionKind = 'ubl.build' | 'efactura.upload';

export interface OutputTarget {
  mode: 'stdout' | 'file';
  /** Required when mode === 'file'. */
  path?: string;
}

export interface InvoiceLineAction {
  description: string;
  quantity: number;
  unitPrice: number;
  taxPercent: number;
  unitCode?: string;
}

export interface PartyOverride {
  registrationName?: string;
  companyId?: string;
  vatNumber?: string;
  email?: string;
  telephone?: string;
  partyIdentificationId?: string;
  address?: {
    street?: string;
    city?: string;
    postalZone?: string;
    county?: string;
    countryCode?: string;
  };
}

export interface InvoiceOverrides {
  supplier?: PartyOverride;
  customer?: PartyOverride;
  note?: string;
  paymentIban?: string;
  currency?: string;
  dueDate?: string;
}

export interface UblBuildAction {
  kind: 'ubl.build';
  /** Resolved context name. */
  context: string;
  invoice: {
    invoiceNumber: string;
    /** YYYY-MM-DD */
    issueDate: string;
    /** YYYY-MM-DD */
    dueDate?: string;
    customerCui: string;
    lines: InvoiceLineAction[];
    /**
     * Invoice type code (BT-3), CIUS-RO subset of UNTDID 1001:
     * 380 commercial (default), 384 corrective, 389 self-billed, 751 accounting.
     */
    invoiceTypeCode?: InvoiceTypeCode;
    /** Defaults to RON downstream. */
    currency?: string;
    /**
     * Total VAT amount in RON when invoice currency is not RON (CIUS-RO BR-53 / BT-111).
     * Required for valid non-RON invoices.
     */
    taxCurrencyTaxAmount?: number;
    note?: string;
    paymentIban?: string;
    overrides?: InvoiceOverrides;
  };
  output: OutputTarget;
}

export interface EfacturaUploadAction {
  kind: 'efactura.upload';
  context: string;
  source: { type: 'xmlFile'; path: string } | { type: 'xmlStdin' } | { type: 'ublBuild'; build: UblBuildAction };
  upload: {
    standard: 'UBL' | 'CN' | 'CII' | 'RASP';
    isB2C?: boolean;
    isExecutare?: boolean;
  };
  output: OutputTarget;
}
