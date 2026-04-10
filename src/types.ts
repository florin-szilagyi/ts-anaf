/**
 * Configuration for ANAF OAuth 2.0 authentication
 */
export interface AnafAuthConfig {
  /** OAuth 2.0 client ID obtained from ANAF SPV */
  clientId: string;
  /** OAuth 2.0 client secret obtained from ANAF SPV */
  clientSecret: string;
  /** OAuth 2.0 redirect URI registered with ANAF */
  redirectUri: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

/**
 * Configuration for ANAF e-Factura client
 *
 * @example
 * ```typescript
 * const config: AnafEfacturaClientConfig = {
 *   vatNumber: 'RO12345678',
 *   testMode: true,
 *   refreshToken: 'your_refresh_token',
 * };
 * ```
 */
export interface AnafEfacturaClientConfig {
  /** Romanian VAT number (CIF) in format RO12345678 */
  vatNumber: string;
  /** Whether to use test environment (default: false) */
  testMode?: boolean;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Additional axios configuration */
  axiosOptions?: any;
  /** Custom base path (overrides default) */
  basePath?: string;

  // Authentication configuration for automatic token management
  /** OAuth 2.0 refresh token for automatic access token refresh */
  refreshToken: string;
}

/**
 * OAuth 2.0 token response from ANAF
 */
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

/**
 * Simplified token interface for easier usage
 */
export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn?: number;
  tokenType?: string;
}

/**
 * Standard document types supported by ANAF e-Factura
 */
export type StandardType = 'UBL' | 'CN' | 'CII' | 'RASP';

/**
 * Document standards for validation and PDF conversion
 */
export type DocumentStandardType = 'FACT1' | 'FCN';

/**
 * Execution status for upload operations
 * 0 indicates success, 1 indicates error
 */
export enum ExecutionStatus {
  Success = 0,
  Error = 1,
}

/**
 * Status values for upload processing (stare field)
 * As defined in OpenAPI spec for status check responses
 */
export enum UploadStatusValue {
  /** Processing completed successfully */
  Ok = 'ok',
  /** Processing failed */
  Failed = 'nok',
  /** Currently being processed */
  InProgress = 'in prelucrare',
}

/**
 * Upload options for document submission
 */
export interface UploadOptions {
  /** Document standard (default: 'UBL') */
  standard?: StandardType;
  /** Whether this is an external invoice */
  extern?: boolean;
  /** Whether this is a self-invoice (autofactura) */
  autofactura?: boolean;
  /** Whether to execute the operation immediately */
  executare?: boolean;
}

/**
 * Message filters for listing operations
 * Each filter type represents a specific message category in the ANAF e-Factura system
 */
export enum MessageFilter {
  /** FACTURA TRIMISA - Invoice sent by you to a buyer */
  InvoiceSent = 'T',
  /** FACTURA PRIMITA - Invoice received by you from a supplier */
  InvoiceReceived = 'P',
  /** ERORI FACTURA - Error messages returned after uploading invalid XML */
  InvoiceErrors = 'E',
  /** MESAJ CUMPARATOR - RASP message/comment from buyer to issuer (or vice versa) */
  BuyerMessage = 'R',
}

/**
 * Parameters for listing messages
 */
export interface ListMessagesParams {
  /** Number of days to query (1-60) */
  zile: number;
  /** Message filter type */
  filtru?: MessageFilter;
}

/**
 * Parameters for paginated message listing
 */
export interface PaginatedMessagesParams {
  /** Start time (Unix timestamp in milliseconds) */
  startTime: number;
  /** End time (Unix timestamp in milliseconds) */
  endTime: number;
  /** Page number */
  pagina: number;
  /** Message filter type */
  filtru?: MessageFilter;
}

/**
 * Individual message details matching OpenAPI EfacturaDetailedMessage schema
 */
export interface MessageDetails {
  /** Request ID */
  id_solicitare: string;
  /** Message type */
  tip: string;
  /** Creation date */
  data_creare: string;
  /** Download ID */
  id: string;
  /** Message details */
  detalii: string;
  /** CIF number (required as per OpenAPI examples) */
  cif: string;
}

/**
 * Response from simple message listing operations (listaMesajeFactura)
 */
export interface ListMessagesResponse {
  /** Array of messages */
  mesaje?: MessageDetails[];
  /** Error message if applicable */
  eroare?: string;
  /** Serial number */
  serial?: string;
  /** CIF number */
  cui?: string;
  /** Response title */
  titlu?: string;
  /** Additional info */
  info?: string;
  /** Download error message */
  eroare_descarcare?: string;
}

/**
 * Response from paginated message listing operations (listaMesajePaginatieFactura)
 * Includes all pagination metadata as defined in OpenAPI specification
 */
export interface PaginatedListMessagesResponse {
  /** Array of messages */
  mesaje?: MessageDetails[];
  /** Number of records in current page */
  numar_inregistrari_in_pagina?: number;
  /** Total number of records per page (page size limit) */
  numar_total_inregistrari_per_pagina?: number;
  /** Total number of records across all pages */
  numar_total_inregistrari?: number;
  /** Total number of pages */
  numar_total_pagini?: number;
  /** Current page index */
  index_pagina_curenta?: number;
  /** Serial number */
  serial?: string;
  /** CIF number */
  cui?: string;
  /** Response title */
  titlu?: string;
  /** Error message if applicable */
  eroare?: string;
}

/**
 * Validation result for XML documents
 */
export interface ValidationResult {
  /** Whether the document is valid */
  valid: boolean;
  /** Validation details or error messages */
  details: string;
  /** Additional validation info */
  info?: string;
}

/**
 * Address information for UBL parties
 */
export interface Address {
  /** Street address */
  street: string;
  /** City name */
  city: string;
  /** Postal code */
  postalZone: string;
  /** County/Region (optional) */
  county?: string;
  /** Country code (default: 'RO') */
  countryCode?: string;
}

/**
 * Party information for suppliers and customers
 */
export interface Party {
  /** Company registration name */
  registrationName: string;
  /** Company ID (CIF/CUI) */
  companyId: string;
  /** VAT number (e.g., RO12345678) */
  vatNumber?: string;
  /** Company address */
  address: Address;
  /** Contact email address */
  email?: string;
  /** Contact telephone number */
  telephone?: string;
  /** Party identification ID (supplementary ID, e.g. internal reference) */
  partyIdentificationId?: string;
}

/**
 * Invoice line item
 */
export interface InvoiceLine {
  /** Line ID (optional, will be auto-generated) */
  id?: string | number;
  /** Item description */
  description: string;
  /** Quantity */
  quantity: number;
  /** Unit of measure code (default: 'EA') */
  unitCode?: string;
  /** Unit price excluding VAT */
  unitPrice: number;
  /** VAT percentage (default: 0) */
  taxPercent?: number;
}

/**
 * Complete invoice data for UBL generation
 */
export interface InvoiceInput {
  /** Invoice number */
  invoiceNumber: string;
  /** Issue date */
  issueDate: string | Date;
  /** Due date (optional, defaults to issue date) */
  dueDate?: string | Date;
  /** Currency code (default: 'RON') */
  currency?: string;
  /** Invoice note / description */
  note?: string;
  /** Invoice period end date */
  invoicePeriodEndDate?: string | Date;
  /** Supplier information */
  supplier: Party;
  /** Customer information */
  customer: Party;
  /** Invoice line items */
  lines: InvoiceLine[];
  /** Payment IBAN (optional) */
  paymentIban?: string;
  /** Whether supplier is VAT registered */
  isSupplierVatPayer?: boolean;
}

/**
 * Legacy interface for backward compatibility
 */
export interface UblInvoiceInput extends InvoiceInput {
  isSupplierVatPayer: boolean;
}

/**
 * Legacy interfaces for backward compatibility
 */
export interface UblAddress extends Address {}
export interface UblParty extends Party {
  vatIdentifier?: string;
}
export interface UblInvoiceLine extends InvoiceLine {}

/**
 * Error response structure
 */
export interface ErrorResponse {
  /** Error message */
  eroare?: string;
  /** Additional message */
  mesaj?: string;
  /** Error details */
  detalii?: string;
}

/**
 * Generic API response wrapper
 */
export interface ApiResponse<T = any> {
  /** Response data */
  data?: T;
  /** Success indicator */
  success: boolean;
  /** Error information */
  error?: string;
  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * ANAF Company Details API Types
 */

/**
 * Configuration for ANAF Details client
 */
export interface AnafDetailsConfig {
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** ANAF API URL for company data (sync) */
  url?: string;
  /** ANAF e-Factura registry interrogation URL */
  efacturaRegistryUrl?: string;
  /** ANAF async API URL for submitting requests (POST) */
  asyncUrl?: string;
  /** ANAF async API URL for fetching results (GET) */
  asyncResultUrl?: string;
}

/**
 * Company data from ANAF public API
 */
export interface AnafCompanyData {
  /** Company name */
  name: string;
  /** VAT code (CUI/CIF) */
  vatCode: string;
  /** Trade registry number */
  registrationNumber: string;
  /** Company address */
  address: string;
  /** Postal code */
  postalCode: string | null;
  /** Contact phone */
  contactPhone: string;
  /** Whether company is VAT registered */
  scpTva: boolean;
  /** e-Factura registry information (if available) */
  efacturaRegistry?: {
    /** Whether the company is registered in the e-Factura registry */
    registered: boolean;
    /** Registry name */
    registru?: string;
    /** Taxpayer category */
    categorie?: string;
    /** Date of registration */
    dataInscriere?: string;
    /** Date of voluntary withdrawal */
    dataRenuntare?: string | null;
    /** Date of deregistration */
    dataRadiere?: string | null;
    /** Date B2G option was expressed */
    dataOptiuneB2G?: string | null;
    /** Current state at the requested date */
    stare?: string;
  };
}

/**
 * Result from ANAF company lookup
 */
export interface AnafCompanyResult {
  /** Whether the lookup was successful */
  success: boolean;
  /** Company data if found */
  data?: AnafCompanyData[];
  /** Error message if lookup failed */
  error?: string;
}

/**
 * Internal ANAF API request payload
 */
export interface AnafRequestPayload {
  cui: number;
  data: string;
}

/**
 * Internal ANAF API company info structure
 */
export interface AnafCompanyInfo {
  cui: number;
  denumire: string;
  adresa: string;
  nrRegCom: string;
  telefon: string;
  codPostal: string | null;
}

/**
 * Internal ANAF API VAT registration info
 */
export interface AnafScpTvaInfo {
  scpTVA: boolean;
}

/**
 * Internal ANAF API found company structure
 */
export interface AnafFoundCompany {
  date_generale: AnafCompanyInfo;
  inregistrare_scop_Tva: AnafScpTvaInfo;
}

/**
 * Internal ANAF API response structure
 */
export interface AnafApiResponse {
  found?: AnafFoundCompany[];
  notFound?: { cui: number }[];
}

// ─── Async ANAF API types (v8) ───────────────────────────────────────────────

/**
 * Response from the async ANAF API submit endpoint (POST)
 */
export interface AnafAsyncSubmitResponse {
  cod: number;
  message: string;
  correlationId: string;
}

/**
 * Full company details from the async ANAF API (v8)
 */
export interface AnafCompanyFullDetails {
  date_generale: {
    cui: number;
    data: string;
    denumire: string;
    adresa: string;
    nrRegCom: string;
    telefon: string;
    fax: string;
    codPostal: string | null;
    act: string;
    stare_inregistrare: string;
    data_inregistrare: string;
    cod_CAEN: string;
    iban: string;
    statusRO_e_Factura: boolean;
    organFiscalCompetent: string;
    forma_de_proprietate: string;
    forma_organizare: string;
    forma_juridica: string;
  };
  inregistrare_scop_Tva: {
    scpTVA: boolean;
    perioade_TVA?: {
      data_inceput_ScpTVA: string;
      data_sfarsit_ScpTVA: string;
      data_anul_imp_ScpTVA: string;
      mesaj_ScpTVA: string;
    };
  };
  inregistrare_RTVAI: {
    dataInceputTvaInc: string;
    dataSfarsitTvaInc: string;
    dataActualizareTvaInc: string;
    dataPublicareTvaInc: string;
    tipActTvaInc: string;
    statusTvaIncasare: boolean;
  };
  stare_inactiv: {
    dataInactivare: string;
    dataReactivare: string;
    dataPublicare: string;
    dataRadiere: string;
    statusInactivi: boolean;
  };
  inregistrare_SplitTVA: {
    dataInceputSplitTVA: string;
    dataAnulareSplitTVA: string;
    statusSplitTVA: boolean;
  };
  adresa_sediu_social: {
    sdenumire_Strada: string;
    snumar_Strada: string;
    sdenumire_Localitate: string;
    scod_Localitate: string;
    sdenumire_Judet: string;
    scod_Judet: string;
    scod_JudetAuto: string;
    stara: string;
    sdetalii_Adresa: string;
    scod_Postal: string;
  };
  adresa_domiciliu_fiscal: {
    ddenumire_Strada: string;
    dnumar_Strada: string;
    ddenumire_Localitate: string;
    dcod_Localitate: string;
    ddenumire_Judet: string;
    dcod_Judet: string;
    dcod_JudetAuto: string;
    dtara: string;
    ddetalii_Adresa: string;
    dcod_Postal: string;
  };
}

/**
 * Full async API response structure (GET result)
 */
export interface AnafAsyncResultResponse {
  cod: number;
  message: string;
  found: AnafCompanyFullDetails[];
  notFound: { cui: number }[];
}

/**
 * Configuration for async polling behavior
 */
export interface AnafAsyncPollingConfig {
  /** Initial delay before first poll in ms (default: 2000, minimum enforced: 2000) */
  initialDelay?: number;
  /** Delay between poll retries in ms (default: 3000) */
  retryDelay?: number;
  /** Maximum number of poll attempts (default: 10) */
  maxRetries?: number;
}

/**
 * Result from async ANAF company lookup (includes full details)
 */
export interface AnafAsyncCompanyResult {
  success: boolean;
  /** Simplified company data (same shape as sync API) */
  data?: AnafCompanyData[];
  /** Full detailed response from ANAF async API */
  fullDetails?: AnafCompanyFullDetails[];
  /** CUIs that were not found */
  notFound?: number[];
  error?: string;
}

/**
 * e-Factura registry entry returned by the registruroefactura endpoint
 */
export interface EFacturaRegistryEntry {
  /** CUI number */
  cui: number;
  /** Company name */
  denumire: string;
  /** Registered address */
  adresa: string;
  /** Registry name the company is registered in */
  registru: string;
  /** Taxpayer category */
  categorie: string;
  /** Date of registration in the registry */
  dataInscriere: string;
  /** Date of voluntary withdrawal (if applicable) */
  dataRenuntare: string | null;
  /** Date of deregistration (if applicable) */
  dataRadiere: string | null;
  /** Date the B2G option was expressed (if applicable) */
  dataOptiuneB2G: string | null;
  /** Whether the company is currently registered at the requested date */
  stare: string;
}

/**
 * Response from the e-Factura registry interrogation endpoint
 */
export interface EFacturaRegistryResponse {
  /** Companies found in the registry */
  found: EFacturaRegistryEntry[];
  /** CUI numbers not found in the registry */
  notFound: number[];
}

/**
 * Response from upload operations (uploadDocument, uploadB2CDocument)
 * Corresponds to the EfacturaXmlHeader schema from upload.json
 */
export interface UploadResponse {
  /** Execution status (0=success, 1=error) */
  executionStatus: ExecutionStatus;
  /** Upload ID for status checking (only on success) */
  indexIncarcare?: string;
  /** Response timestamp from ANAF */
  dateResponse?: string;
  /** Error messages (only on error) */
  errors?: string[];
}

/**
 * Response from status check operations (getUploadStatus)
 * Corresponds to the EfacturaXmlHeader schema for status responses
 */
export interface StatusResponse {
  /** Processing status */
  stare?: UploadStatusValue;
  /** Download ID for retrieving results (only when stare=ok) */
  idDescarcare?: string;
  /** Error messages (only on error) */
  errors?: string[];
}
