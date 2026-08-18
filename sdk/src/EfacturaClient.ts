import {
  EfacturaClientConfig,
  UploadOptions,
  ListMessagesParams,
  PaginatedMessagesParams,
  ListMessagesResponse,
  PaginatedListMessagesResponse,
  RawListMessagesResponse,
  RawPaginatedListMessagesResponse,
  RawMessageDetails,
  MessageDetails,
  UploadResponse,
  StatusResponse,
} from './types';
import { parseDetalii } from './utils/messageParser';
import { AnafValidationError, AnafApiError } from './errors';
import {
  getBasePath,
  UPLOAD_PATH,
  UPLOAD_B2C_PATH,
  STATUS_MESSAGE_PATH,
  DOWNLOAD_PATH,
  LIST_MESSAGES_PATH,
  LIST_MESSAGES_PAGINATED_PATH,
  DEFAULT_TIMEOUT,
  buildUploadParams,
  buildStatusParams,
  buildDownloadParams,
  buildListMessagesParams,
  buildPaginatedMessagesParams,
} from './constants';
import {
  parseUploadResponse,
  parseStatusResponse,
  parseJsonResponse,
  isErrorResponse,
  extractErrorMessage,
} from './utils/xmlParser';
import { isValidDaysParameter } from './utils/dateUtils';
import { extractInvoiceXml } from './utils/zipReader';
import { HttpClient } from './utils/httpClient';
import { handleApiError } from './utils/errorHandler';
import { tryCatch } from './tryCatch';
import { TokenManager } from './TokenManager';

function transformRawMessage(raw: RawMessageDetails): MessageDetails {
  const { id_solicitare: _, cif: __, ...rest } = raw;
  return { ...rest, ...parseDetalii(raw.detalii) };
}

/**
 * Client for core e-Factura invoice operations: upload, status, download, and message listing.
 *
 * Requires a VAT number and a TokenManager for OAuth authentication.
 *
 * @example
 * ```typescript
 * import { EfacturaClient, TokenManager, AnafAuthenticator } from 'anaf-ts-sdk';
 *
 * const authenticator = new AnafAuthenticator({ clientId, clientSecret, redirectUri });
 * const tokenManager = new TokenManager(authenticator, refreshToken);
 *
 * const client = new EfacturaClient({ vatNumber: 'RO12345678', testMode: true }, tokenManager);
 *
 * const result = await client.uploadDocument(xmlContent);
 * const status = await client.getUploadStatus(result.indexIncarcare);
 * ```
 */
export class EfacturaClient {
  private config: Required<EfacturaClientConfig>;
  private httpClient: HttpClient;
  private tokenManager: TokenManager;

  constructor(config: EfacturaClientConfig, tokenManager: TokenManager, httpClient?: HttpClient) {
    if (!config?.vatNumber?.trim()) {
      throw new AnafValidationError('VAT number is required');
    }

    this.config = {
      vatNumber: config.vatNumber,
      testMode: config.testMode ?? false,
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      basePath: config.basePath ?? '',
    };

    const basePath = this.config.basePath || getBasePath('oauth', this.config.testMode);

    this.httpClient =
      httpClient ??
      new HttpClient({
        baseURL: basePath,
        timeout: this.config.timeout,
      });

    this.tokenManager = tokenManager;
  }

  // ==========================================================================
  // DOCUMENT UPLOAD
  // ==========================================================================

  async uploadDocument(xmlContent: string, options: UploadOptions = {}): Promise<UploadResponse> {
    this.validateXmlContent(xmlContent);
    this.validateUploadOptions(options);

    const params = buildUploadParams(this.config.vatNumber, options);
    const url = `${UPLOAD_PATH}?${params.toString()}`;

    const { data, error } = await tryCatch(async () => {
      const accessToken = await this.tokenManager.getValidAccessToken();
      const response = await this.httpClient.post<string>(url, xmlContent, {
        headers: {
          'Content-Type': 'application/xml',
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return parseUploadResponse(response.data);
    });

    if (error) {
      handleApiError(error, 'Failed to upload document');
    }

    return data;
  }

  async uploadB2CDocument(xmlContent: string, options: UploadOptions = {}): Promise<UploadResponse> {
    this.validateXmlContent(xmlContent);
    this.validateUploadOptions(options);

    const params = buildUploadParams(this.config.vatNumber, options);
    const url = `${UPLOAD_B2C_PATH}?${params.toString()}`;

    const { data, error } = await tryCatch(async () => {
      const accessToken = await this.tokenManager.getValidAccessToken();
      const response = await this.httpClient.post<string>(url, xmlContent, {
        headers: {
          'Content-Type': 'application/xml',
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return parseUploadResponse(response.data);
    });

    if (error) {
      handleApiError(error, 'Failed to upload B2C document');
    }

    return data;
  }

  // ==========================================================================
  // STATUS AND DOWNLOAD
  // ==========================================================================

  async getUploadStatus(uploadId: string): Promise<StatusResponse> {
    if (!uploadId?.trim()) {
      throw new AnafValidationError('Upload ID is required');
    }

    const params = buildStatusParams(uploadId);
    const url = `${STATUS_MESSAGE_PATH}?${params.toString()}`;

    const { data, error } = await tryCatch(async () => {
      const accessToken = await this.tokenManager.getValidAccessToken();
      const response = await this.httpClient.get<string>(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return parseStatusResponse(response.data);
    });

    if (error) {
      handleApiError(error, 'Failed to get upload status');
    }

    return data;
  }

  async downloadDocument(downloadId: string): Promise<Buffer> {
    if (!downloadId?.trim()) {
      throw new AnafValidationError('Download ID is required');
    }

    const params = buildDownloadParams(downloadId);
    const url = `${DOWNLOAD_PATH}?${params.toString()}`;

    const { data, error } = await tryCatch(async () => {
      const accessToken = await this.tokenManager.getValidAccessToken();
      const response = await this.httpClient.get<ArrayBuffer>(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return Buffer.from(response.data);
    });

    if (error) {
      handleApiError(error, 'Failed to download document');
    }

    return data;
  }

  /**
   * Download a document and return the invoice XML it contains.
   *
   * ANAF serves downloads as a ZIP holding the invoice plus a detached
   * signature; this unwraps the archive and returns the invoice document.
   *
   * @param downloadId - The `idDescarcare` from a status response or message list
   * @returns The invoice XML as a UTF-8 string
   */
  async downloadDocumentXml(downloadId: string): Promise<string> {
    const archive = await this.downloadDocument(downloadId);
    return extractInvoiceXml(archive);
  }

  // ==========================================================================
  // MESSAGE LISTING
  // ==========================================================================

  async getMessagesPaginated(params: PaginatedMessagesParams): Promise<PaginatedListMessagesResponse> {
    this.validatePaginatedMessagesParams(params);

    const queryParams = buildPaginatedMessagesParams(
      this.config.vatNumber,
      params.startTime,
      params.endTime,
      params.pagina,
      params.filtru
    );
    const url = `${LIST_MESSAGES_PAGINATED_PATH}?${queryParams.toString()}`;

    const { data, error } = await tryCatch(async () => {
      const accessToken = await this.tokenManager.getValidAccessToken();
      const response = await this.httpClient.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const raw = parseJsonResponse<RawPaginatedListMessagesResponse>(response.data);

      if (isErrorResponse(raw)) {
        throw new AnafApiError(extractErrorMessage(raw) || 'Error retrieving paginated messages');
      }

      return {
        ...raw,
        mesaje: raw.mesaje ? raw.mesaje.map(transformRawMessage) : undefined,
      } as PaginatedListMessagesResponse;
    });

    if (error) {
      handleApiError(error, 'Failed to get paginated messages');
    }

    return data;
  }

  async getMessages(params: ListMessagesParams): Promise<ListMessagesResponse> {
    this.validateListMessagesParams(params);

    const queryParams = buildListMessagesParams(this.config.vatNumber, params.zile, params.filtru);
    const url = `${LIST_MESSAGES_PATH}?${queryParams.toString()}`;

    const { data, error } = await tryCatch(async () => {
      const accessToken = await this.tokenManager.getValidAccessToken();
      const response = await this.httpClient.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const raw = parseJsonResponse<RawListMessagesResponse>(response.data);

      if (isErrorResponse(raw)) {
        throw new AnafApiError(extractErrorMessage(raw) || 'Error retrieving messages');
      }

      return {
        ...raw,
        mesaje: raw.mesaje ? raw.mesaje.map(transformRawMessage) : undefined,
      } as ListMessagesResponse;
    });

    if (error) {
      handleApiError(error, 'Failed to get messages');
    }

    return data;
  }

  // ==========================================================================
  // PRIVATE VALIDATORS
  // ==========================================================================

  private validateXmlContent(xmlContent: string): void {
    if (!xmlContent?.trim()) {
      throw new AnafValidationError('XML content is required');
    }
  }

  private validateUploadOptions(options: UploadOptions): void {
    if (options.standard && !['UBL', 'CN', 'CII', 'RASP'].includes(options.standard)) {
      throw new AnafValidationError('Standard must be one of: UBL, CN, CII, RASP');
    }
  }

  private validateListMessagesParams(params: ListMessagesParams): void {
    if (!params) {
      throw new AnafValidationError('Message listing parameters are required');
    }
    if (!isValidDaysParameter(params.zile)) {
      throw new AnafValidationError('Days parameter must be between 1 and 60');
    }
  }

  private validatePaginatedMessagesParams(params: PaginatedMessagesParams): void {
    if (!params) {
      throw new AnafValidationError('Paginated message parameters are required');
    }
    if (typeof params.startTime !== 'number' || params.startTime <= 0) {
      throw new AnafValidationError('Valid start time is required');
    }
    if (typeof params.endTime !== 'number' || params.endTime <= 0) {
      throw new AnafValidationError('Valid end time is required');
    }
    if (params.endTime <= params.startTime) {
      throw new AnafValidationError('End time must be after start time');
    }
    if (typeof params.pagina !== 'number' || params.pagina < 1) {
      throw new AnafValidationError('Page number must be 1 or greater');
    }
  }
}
