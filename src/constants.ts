/**
 * ANAF e-Factura API Constants
 *
 * This file contains all the endpoints and configuration constants
 * for interacting with the Romanian ANAF e-Factura system.
 */

import { StandardType } from './types';

// =============================================================================
// Base API Paths
// =============================================================================

/**
 * OAuth-based API endpoints (recommended)
 * Note: Trailing slash is required for proper URL construction with new URL()
 */
export const BASE_PATH_OAUTH_TEST = 'https://api.anaf.ro/test/FCTEL/rest/';
export const BASE_PATH_OAUTH_PROD = 'https://api.anaf.ro/prod/FCTEL/rest/';

/**
 * Certificate-based API endpoints
 */
export const BASE_PATH_CERT_TEST = 'https://webserviceapl.anaf.ro/test/FCTEL/rest/';
export const BASE_PATH_CERT_PROD = 'https://webserviceapl.anaf.ro/prod/FCTEL/rest/';

// =============================================================================
// OAuth 2.0 Authentication Endpoints
// =============================================================================

/**
 * OAuth authorization endpoint
 * Used to initiate the OAuth flow and obtain authorization code
 */
export const OAUTH_AUTHORIZE_URL = 'https://logincert.anaf.ro/anaf-oauth2/v1/authorize';

/**
 * OAuth token endpoint
 * Used to exchange authorization code for access token and refresh tokens
 */
export const OAUTH_TOKEN_URL = 'https://logincert.anaf.ro/anaf-oauth2/v1/token';

// =============================================================================
// Core e-Factura API Endpoints (relative paths)
// =============================================================================

/**
 * Upload invoice document
 * POST {basePath}/upload?standard={UBL|CN|CII|RASP}&cif={vatNumber}
 * Optional params: extern, autofactura, executare
 * Note: No leading slash - relative to base path for proper URL construction
 */
export const UPLOAD_PATH = 'upload';

/**
 * Upload B2C (Business to Consumer) invoice
 * POST {basePath}/uploadb2c?cif={vatNumber}
 * Used for simplified B2C invoices
 * Note: No leading slash - relative to base path for proper URL construction
 */
export const UPLOAD_B2C_PATH = 'uploadb2c';

/**
 * Check upload status
 * GET {basePath}/stareMesaj?id_incarcare={uploadId}
 * Returns current processing status of uploaded document
 * Note: No leading slash - relative to base path for proper URL construction
 */
export const STATUS_MESSAGE_PATH = 'stareMesaj';

/**
 * Download processed document
 * GET {basePath}/descarcare?id={downloadId}
 * Downloads the processed invoice or error details
 * Note: No leading slash - relative to base path for proper URL construction
 */
export const DOWNLOAD_PATH = 'descarcare';

/**
 * List messages (simple)
 * GET {basePath}/listaMesajeFactura?zile={days}&cif={vatNumber}
 * Optional param: filtru={E|T|P|R}
 * Note: No leading slash - relative to base path for proper URL construction
 */
export const LIST_MESSAGES_PATH = 'listaMesajeFactura';

/**
 * List messages with pagination
 * GET {basePath}/listaMesajePaginatieFactura?startTime={timestamp}&endTime={timestamp}&pagina={page}&cif={vatNumber}
 * Optional param: filtru={E|T|P|R}
 * Note: No leading slash - relative to base path for proper URL construction
 */
export const LIST_MESSAGES_PAGINATED_PATH = 'listaMesajePaginatieFactura';

// =============================================================================
// Validation and Conversion Endpoints
// =============================================================================

/**
 * XML validation endpoint for OAuth
 * POST https://api.anaf.ro/prod/FCTEL/rest/validare
 * Validates XML documents against ANAF schemas
 */
export const VALIDATE_XML_OAUTH_URL = 'https://api.anaf.ro/prod/FCTEL/rest/validare';

/**
 * XML validation endpoint for Certificate auth
 * POST https://webservicesp.anaf.ro/prod/FCTEL/rest/validare
 */
export const VALIDATE_XML_CERT_URL = 'https://webservicesp.anaf.ro/prod/FCTEL/rest/validare';

/**
 * XML to PDF conversion endpoint for OAuth
 * POST https://api.anaf.ro/prod/FCTEL/rest/transformare/{standard}[/DA]
 * Converts e-Factura XML to PDF format
 */
export const XML_TO_PDF_OAUTH_URL = 'https://api.anaf.ro/prod/FCTEL/rest/transformare';

/**
 * XML to PDF conversion endpoint for Certificate auth
 * POST https://webservicesp.anaf.ro/prod/FCTEL/rest/transformare/{standard}[/DA]
 */
export const XML_TO_PDF_CERT_URL = 'https://webservicesp.anaf.ro/prod/FCTEL/rest/transformare';

/**
 * Digital signature validation endpoint for OAuth
 * POST https://api.anaf.ro/api/validate/signature
 * Validates digital signatures on XML documents
 */
export const VALIDATE_SIGNATURE_OAUTH_URL = 'https://api.anaf.ro/api/validate/signature';

/**
 * Digital signature validation endpoint for Certificate auth
 * POST https://webservicesp.anaf.ro/api/validate/signature
 */
export const VALIDATE_SIGNATURE_CERT_URL = 'https://webservicesp.anaf.ro/api/validate/signature';

// =============================================================================
// Default Configuration Values
// =============================================================================

/**
 * Default request timeout in milliseconds
 */
export const DEFAULT_TIMEOUT = 30000;

/**
 * Default currency for invoices
 */
export const DEFAULT_CURRENCY = 'RON';

/**
 * Default country code for addresses
 */
export const DEFAULT_COUNTRY_CODE = 'RO';

/**
 * Default unit of measure code
 */
export const DEFAULT_UNIT_CODE = 'EA'; // Each

/**
 * UBL customization ID for CIUS-RO compliance
 */
export const UBL_CUSTOMIZATION_ID = 'urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1';

/**
 * Default invoice type code (Commercial Invoice)
 */
export const INVOICE_TYPE_CODE = '380';

// =============================================================================
// Helper Functions for URL Construction
// =============================================================================

/**
 * Get the appropriate base path based on auth mode and environment
 */
export const getBasePath = (authMode: 'oauth' | 'cert' = 'oauth', testMode: boolean = false): string => {
  if (authMode === 'cert') {
    return testMode ? BASE_PATH_CERT_TEST : BASE_PATH_CERT_PROD;
  }
  return testMode ? BASE_PATH_OAUTH_TEST : BASE_PATH_OAUTH_PROD;
};

// =============================================================================
// Query Parameter Builders
// =============================================================================

/**
 * Build upload query parameters
 */
export const buildUploadParams = (
  vatNumber: string,
  options: {
    standard?: StandardType;
    extern?: boolean;
    autofactura?: boolean;
    executare?: boolean;
  } = {}
): URLSearchParams => {
  const params = new URLSearchParams();
  params.append('cif', vatNumber);
  params.append('standard', options.standard || 'UBL');

  if (options.extern) params.append('extern', 'DA');
  if (options.autofactura) params.append('autofactura', 'DA');
  if (options.executare) params.append('executare', 'DA');

  return params;
};

/**
 * Build status check query parameters
 */
export const buildStatusParams = (uploadId: string): URLSearchParams => {
  const params = new URLSearchParams();
  params.append('id_incarcare', uploadId);
  return params;
};

/**
 * Build download query parameters
 */
export const buildDownloadParams = (downloadId: string): URLSearchParams => {
  const params = new URLSearchParams();
  params.append('id', downloadId);
  return params;
};

/**
 * Build list messages query parameters
 */
export const buildListMessagesParams = (vatNumber: string, days: number, filter?: string): URLSearchParams => {
  const params = new URLSearchParams();
  params.append('cif', vatNumber);
  params.append('zile', days.toString());

  if (filter) params.append('filtru', filter);

  return params;
};

/**
 * Build paginated list messages query parameters
 */
export const buildPaginatedMessagesParams = (
  vatNumber: string,
  startTime: number,
  endTime: number,
  page: number,
  filter?: string
): URLSearchParams => {
  const params = new URLSearchParams();
  params.append('cif', vatNumber);
  params.append('startTime', startTime.toString());
  params.append('endTime', endTime.toString());
  params.append('pagina', page.toString());

  if (filter) params.append('filtru', filter);

  return params;
};
