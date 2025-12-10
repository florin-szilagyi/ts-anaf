import {
  AnafEfacturaClientConfig,
  UploadOptions,
  ListMessagesParams,
  PaginatedMessagesParams,
  ListMessagesResponse,
  PaginatedListMessagesResponse,
  ValidationResult,
  DocumentStandardType,
  UploadResponse,
  StatusResponse,
  TokenResponse,
} from './types';
import { AnafSdkError, AnafApiError, AnafValidationError, AnafAuthenticationError } from './errors';
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
import { HttpClient } from './utils/httpClient';
import { tryCatch } from './tryCatch';
import { AnafAuthenticator } from './AnafAuthenticator';

/**
 * Main client for interacting with ANAF e-Factura API
 *
 * This client handles automatic token management and all API operations.
 * Both configuration and authenticator are required for initialization.
 *
 * @example
 * ```typescript
 * import { AnafEfacturaClient, AnafAuthenticator } from 'efactura-ts-sdk';
 *
 * // Create authenticator with OAuth credentials
 * const authenticator = new AnafAuthenticator({
 *   clientId: 'your_client_id',
 *   clientSecret: 'your_client_secret',
 *   redirectUri: 'http://localhost:3000/callback',
 *   testMode: true
 * });
 *
 * // Create client with config and authenticator (both required)
 * const client = new AnafEfacturaClient({
 *   vatNumber: 'RO12345678',
 *   testMode: true,
 *   refreshToken: 'your_refresh_token' // obtained from OAuth flow
 * }, authenticator);
 *
 * // Upload document (automatic token management)
 * const uploadResult = await client.uploadDocument(xmlContent);
 *
 * // Check status (automatic token refresh if needed)
 * const status = await client.getUploadStatus(uploadResult.indexIncarcare);
 *
 * // Download processed document
 * if (status.stare === 'ok' && status.idDescarcare) {
 *   const document = await client.downloadDocument(status.idDescarcare);
 * }
 * ```
 */
export class AnafEfacturaClient {
  private config: Required<AnafEfacturaClientConfig>;
  private httpClient: HttpClient;
  private basePath: string;

  // Token management properties
  private authenticator: AnafAuthenticator;
  private currentAccessToken?: string;
  private accessTokenExpiresAt?: number;
  private refreshToken: string;

  /**
   * Create a new ANAF e-Factura client
   *
   * @param config Client configuration
   * @param authenticator Authenticator for OAuth flows and token refresh
   * @throws {AnafValidationError} If required configuration is missing
   */
  constructor(config: AnafEfacturaClientConfig, authenticator: AnafAuthenticator) {
    this.validateConfig(config);

    this.config = {
      ...config,
      testMode: config.testMode ?? false,
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
      axiosOptions: config.axiosOptions ?? {},
      basePath: config.basePath ?? '',
      refreshToken: config.refreshToken,
    };

    this.basePath = this.config.basePath || getBasePath('oauth', this.config.testMode);

    this.httpClient = new HttpClient({
      baseURL: this.basePath,
      timeout: this.config.timeout,
    });

    // Initialize authentication - both refreshToken and authenticator are now required
    this.refreshToken = config.refreshToken;
    this.authenticator = authenticator;
  }

  // ==========================================================================
  // DOCUMENT UPLOAD
  // ==========================================================================

  /**
   * Upload invoice document to ANAF
   *
   * Uploads an XML invoice document (UBL, CN, CII, or RASP format) to ANAF
   * for processing in the e-Factura system.
   *
   * @param xmlContent XML document content as string
   * @param options Upload options (standard, extern, etc.)
   * @returns Upload status with upload ID for tracking
   * @throws {AnafApiError} If upload fails
   * @throws {AnafValidationError} If parameters are invalid
   * @throws {AnafAuthenticationError} If authentication is not configured or fails
   */
  public async uploadDocument(xmlContent: string, options: UploadOptions = {}): Promise<UploadResponse> {
    this.validateXmlContent(xmlContent);
    this.validateUploadOptions(options);

    const params = buildUploadParams(this.config.vatNumber, options);
    const url = `${UPLOAD_PATH}?${params.toString()}`;

    const { data, error } = tryCatch(async () => {
      const accessToken = await this.getValidAccessToken();
      const response = await this.httpClient.post<string>(url, xmlContent, {
        headers: {
          'Content-Type': 'application/xml',
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return parseUploadResponse(response.data);
    });

    if (error) {
      this.handleApiError(error, 'Failed to upload document');
    }

    return data;
  }

  /**
   * Upload B2C (Business to Consumer) invoice
   *
   * Simplified upload method for B2C invoices with reduced validation requirements.
   * Uses identical parameters and response format as B2B upload.
   *
   * @param xmlContent XML document content as string
   * @param options Upload options
   * @returns Upload status with upload ID for tracking
   * @throws {AnafApiError} If upload fails
   * @throws {AnafAuthenticationError} If authentication is not configured or fails
   */
  public async uploadB2CDocument(xmlContent: string, options: UploadOptions = {}): Promise<UploadResponse> {
    this.validateXmlContent(xmlContent);
    this.validateUploadOptions(options);

    const params = buildUploadParams(this.config.vatNumber, options);
    const url = `${UPLOAD_B2C_PATH}?${params.toString()}`;

    const { data, error } = tryCatch(async () => {
      const accessToken = await this.getValidAccessToken();
      const response = await this.httpClient.post<string>(url, xmlContent, {
        headers: {
          'Content-Type': 'application/xml',
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return parseUploadResponse(response.data);
    });

    if (error) {
      this.handleApiError(error, 'Failed to upload B2C document');
    }

    return data;
  }

  // ==========================================================================
  // STATUS AND DOWNLOAD
  // ==========================================================================

  /**
   * Get upload status
   *
   * Check the processing status of a previously uploaded document.
   *
   * @param uploadId Upload ID returned from upload operation
   * @returns Current status of the upload
   * @throws {AnafApiError} If status check fails
   * @throws {AnafValidationError} If parameters are invalid
   * @throws {AnafAuthenticationError} If authentication is not configured or fails
   */
  public async getUploadStatus(uploadId: string): Promise<StatusResponse> {
    this.validateUploadId(uploadId);

    const params = buildStatusParams(uploadId);
    const url = `${STATUS_MESSAGE_PATH}?${params.toString()}`;

    const { data, error } = tryCatch(async () => {
      const accessToken = await this.getValidAccessToken();
      const response = await this.httpClient.get<string>(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return parseStatusResponse(response.data);
    });

    if (error) {
      this.handleApiError(error, 'Failed to get upload status');
    }

    return data;
  }

  /**
   * Download processed document
   *
   * Download the result of a processed document, which may include:
   * - Validated and signed XML
   * - Error details if processing failed
   * - ZIP archive with multiple files
   *
   * @param downloadId Download ID from status response
   * @returns Document content as string
   * @throws {AnafApiError} If download fails
   * @throws {AnafValidationError} If parameters are invalid
   * @throws {AnafAuthenticationError} If authentication is not configured or fails
   */
  public async downloadDocument(downloadId: string): Promise<string> {
    this.validateDownloadId(downloadId);

    const params = buildDownloadParams(downloadId);
    const url = `${DOWNLOAD_PATH}?${params.toString()}`;

    const { data, error } = tryCatch(async () => {
      const accessToken = await this.getValidAccessToken();
      const response = await this.httpClient.get<string>(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      return response.data;
    });

    if (error) {
      this.handleApiError(error, 'Failed to download document');
    }

    return data;
  }

  // ==========================================================================
  // MESSAGE LISTING
  // ==========================================================================

  /**
   * Get messages with pagination
   *
   * Retrieve messages with pagination support for large result sets.
   *
   * @param params Paginated message parameters
   * @returns List of messages for the specified page
   * @throws {AnafApiError} If message retrieval fails
   * @throws {AnafValidationError} If parameters are invalid
   * @throws {AnafAuthenticationError} If authentication is not configured or fails
   */
  public async getMessagesPaginated(params: PaginatedMessagesParams): Promise<PaginatedListMessagesResponse> {
    this.validatePaginatedMessagesParams(params);

    const queryParams = buildPaginatedMessagesParams(
      this.config.vatNumber,
      params.startTime,
      params.endTime,
      params.pagina,
      params.filtru
    );
    const url = `${LIST_MESSAGES_PAGINATED_PATH}?${queryParams.toString()}`;

    const { data, error } = tryCatch(async () => {
      const accessToken = await this.getValidAccessToken();
      const response = await this.httpClient.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = parseJsonResponse<PaginatedListMessagesResponse>(response.data);

      if (isErrorResponse(data)) {
        throw new AnafApiError(extractErrorMessage(data) || 'Error retrieving paginated messages');
      }

      return data;
    });

    if (error) {
      this.handleApiError(error, 'Failed to get paginated messages');
    }

    return data;
  }

  /**
   * Get recent messages
   *
   * Retrieve messages from ANAF for the configured VAT number within
   * the specified number of days.
   *
   * @param params Message listing parameters
   * @returns List of messages
   * @throws {AnafApiError} If message retrieval fails
   * @throws {AnafValidationError} If parameters are invalid
   * @throws {AnafAuthenticationError} If authentication is not configured or fails
   */
  public async getMessages(params: ListMessagesParams): Promise<ListMessagesResponse> {
    this.validateListMessagesParams(params);

    const queryParams = buildListMessagesParams(this.config.vatNumber, params.zile, params.filtru);
    const url = `${LIST_MESSAGES_PATH}?${queryParams.toString()}`;

    const { data, error } = tryCatch(async () => {
      const accessToken = await this.getValidAccessToken();
      const response = await this.httpClient.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const data = parseJsonResponse<ListMessagesResponse>(response.data);

      if (isErrorResponse(data)) {
        throw new AnafApiError(extractErrorMessage(data) || 'Error retrieving messages');
      }

      return data;
    });

    if (error) {
      this.handleApiError(error, 'Failed to get messages');
    }

    return data;
  }

  // ==========================================================================
  // VALIDATION AND CONVERSION
  // ==========================================================================

  /**
   * Validate XML document
   *
   * Validate an XML document against ANAF schemas without uploading it
   * to the e-Factura system.
   *
   * @param xmlContent XML document to validate
   * @param standard Document standard (FACT1 or FCN)
   * @returns Validation result
   * @throws {AnafApiError} If validation request fails
   * @throws {AnafAuthenticationError} If authentication is not configured or fails
   */
  public async validateXml(xmlContent: string, standard: DocumentStandardType = 'FACT1'): Promise<ValidationResult> {
    this.validateXmlContent(xmlContent);
    this.validateDocumentStandard(standard);

    const url = `validare/${standard}`;

    const { data, error } = tryCatch(async () => {
      const accessToken = await this.getValidAccessToken();
      const response = await this.httpClient.post(url, xmlContent, {
        headers: {
          'Content-Type': 'text/plain',
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const responseData = parseJsonResponse(response.data);

      return {
        valid: responseData.stare === 'ok',
        details: responseData.Messages
          ? responseData.Messages.map((m: any) => m.message).join('\n')
          : `Validation ${responseData.stare === 'ok' ? 'passed' : 'failed'}`,
        info: `Validation performed using ${standard} standard (trace_id: ${responseData.trace_id})`,
      };
    });

    if (error) {
      this.handleApiError(error, 'Failed to validate XML');
    }

    return data;
  }

  /**
   * Validate digital signature
   *
   * Validate the digital signature of an XML document and signature file.
   * Accepts either File objects (browser) or Buffer objects (Node.js).
   *
   * @param xmlFile XML document file (File in browser, Buffer in Node.js)
   * @param signatureFile Signature file (File in browser, Buffer in Node.js)
   * @param xmlFileName Name for the XML file (required for Buffer uploads)
   * @param signatureFileName Name for the signature file (required for Buffer uploads)
   * @returns Validation result
   * @throws {AnafApiError} If signature validation fails
   * @throws {AnafAuthenticationError} If authentication is not configured or fails
   */
  public async validateSignature(
    xmlFile: File | Buffer,
    signatureFile: File | Buffer,
    xmlFileName?: string,
    signatureFileName?: string
  ): Promise<ValidationResult> {
    const url = `api/validate/signature`;

    const formData = new FormData();

    // Handle File objects (browser) vs Buffer objects (Node.js)
    if (typeof File !== 'undefined' && xmlFile instanceof File) {
      formData.append('file', xmlFile);
    } else if (xmlFile instanceof Buffer) {
      if (!xmlFileName) {
        throw new AnafValidationError('XML file name is required when uploading Buffer');
      }
      // Create Blob-like object for Node.js compatibility
      // Convert Buffer to Uint8Array for proper type compatibility
      const blob = new Blob([new Uint8Array(xmlFile)], { type: 'text/xml' });
      formData.append('file', blob, xmlFileName);
    } else {
      throw new AnafValidationError('Invalid XML file type. Expected File or Buffer');
    }

    if (typeof File !== 'undefined' && signatureFile instanceof File) {
      formData.append('signature', signatureFile);
    } else if (signatureFile instanceof Buffer) {
      if (!signatureFileName) {
        throw new AnafValidationError('Signature file name is required when uploading Buffer');
      }
      // Create Blob-like object for Node.js compatibility
      // Convert Buffer to Uint8Array for proper type compatibility
      const blob = new Blob([new Uint8Array(signatureFile)], { type: 'application/octet-stream' });
      formData.append('signature', blob, signatureFileName);
    } else {
      throw new AnafValidationError('Invalid signature file type. Expected File or Buffer');
    }

    const { data, error } = tryCatch(async () => {
      const accessToken = await this.getValidAccessToken();
      const response = await this.httpClient.post(url, formData, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const responseData = response.data;
      const msg = responseData.msg || '';

      return {
        valid: msg.includes('validate cu succes') && !msg.includes('NU'),
        details: msg,
      };
    });

    if (error) {
      this.handleApiError(error, 'Failed to validate signature');
    }

    return data;
  }

  /**
   * Convert XML to PDF with validation
   *
   * Convert an e-Factura XML document to PDF format with validation.
   * According to the schema, this either returns PDF binary data or JSON error response.
   *
   * @param xmlContent XML document to convert
   * @param standard Document standard (FACT1 or FCN)
   * @returns PDF content as Buffer
   * @throws {AnafApiError} If conversion fails
   * @throws {AnafAuthenticationError} If authentication is not configured or fails
   */
  public async convertXmlToPdf(xmlContent: string, standard: DocumentStandardType = 'FACT1'): Promise<Buffer> {
    this.validateXmlContent(xmlContent);
    this.validateDocumentStandard(standard);

    const url = `transformare/${standard}`;

    const { data, error } = tryCatch(async () => {
      const accessToken = await this.getValidAccessToken();
      const response = await this.httpClient.post(url, xmlContent, {
        headers: {
          'Content-Type': 'text/plain',
          Authorization: `Bearer ${accessToken}`,
        },
      });

      // Check if response is JSON (error) or binary (PDF)
      if (response.headers?.get('content-type')?.includes('application/json')) {
        const errorData = parseJsonResponse(response.data);
        throw new AnafApiError(
          errorData.Messages ? errorData.Messages.map((m: any) => m.message).join('\n') : 'PDF conversion failed'
        );
      }

      // Return PDF binary data
      if (response.data instanceof ArrayBuffer) {
        return Buffer.from(response.data);
      } else {
        // Fallback for when content-type detection doesn't work
        return Buffer.from(response.data as any);
      }
    });

    if (error) {
      this.handleApiError(error, 'Failed to convert XML to PDF');
    }

    return data;
  }

  /**
   * Convert XML to PDF without validation
   *
   * Convert an e-Factura XML document to PDF format without validation.
   * Note: Without validation, ANAF does not guarantee the correctness of the generated PDF.
   *
   * @param xmlContent XML document to convert
   * @param standard Document standard (FACT1 or FCN)
   * @returns PDF content as Buffer
   * @throws {AnafApiError} If conversion fails
   * @throws {AnafAuthenticationError} If authentication is not configured or fails
   */
  public async convertXmlToPdfNoValidation(
    xmlContent: string,
    standard: DocumentStandardType = 'FACT1'
  ): Promise<Buffer> {
    this.validateXmlContent(xmlContent);
    this.validateDocumentStandard(standard);

    const url = `transformare/${standard}/DA`;

    const { data, error } = tryCatch(async () => {
      const accessToken = await this.getValidAccessToken();
      const response = await this.httpClient.post(url, xmlContent, {
        headers: {
          'Content-Type': 'text/plain',
          Authorization: `Bearer ${accessToken}`,
        },
      });

      // Check if response is JSON (error) or binary (PDF)
      if (response.headers?.get('content-type')?.includes('application/json')) {
        const errorData = parseJsonResponse(response.data);
        throw new AnafApiError(
          errorData.Messages ? errorData.Messages.map((m: any) => m.message).join('\n') : 'PDF conversion failed'
        );
      }

      // Return PDF binary data
      if (response.data instanceof ArrayBuffer) {
        return Buffer.from(response.data);
      } else {
        // Fallback for when content-type detection doesn't work
        return Buffer.from(response.data as any);
      }
    });

    if (error) {
      this.handleApiError(error, 'Failed to convert XML to PDF without validation');
    }

    return data;
  }

  // ==========================================================================
  // PRIVATE METHODS
  // ==========================================================================

  /**
   * Get a valid access token, refreshing if necessary
   * @returns A valid access token
   * @throws {AnafAuthenticationError} If token refresh fails
   */
  private async getValidAccessToken(): Promise<string> {
    // Check if current token is still valid
    if (this.isTokenValid()) {
      return this.currentAccessToken!;
    }

    // Refresh the token
    await this.refreshAccessToken();
    return this.currentAccessToken!;
  }

  /**
   * Check if the current access token is valid and not expired
   * @returns True if token is valid and not expired
   */
  private isTokenValid(): boolean {
    if (!this.currentAccessToken || !this.accessTokenExpiresAt) {
      return false;
    }

    // Add 30 second buffer to avoid using tokens that are about to expire
    const bufferMs = 30 * 1000;
    return Date.now() < this.accessTokenExpiresAt - bufferMs;
  }

  /**
   * Refresh the access token using the stored refresh token
   * @throws {AnafAuthenticationError} If token refresh fails
   */
  private async refreshAccessToken(): Promise<void> {
    try {
      const tokenResponse: TokenResponse = await this.authenticator.refreshAccessToken(this.refreshToken);

      this.currentAccessToken = tokenResponse.access_token;
      this.accessTokenExpiresAt = Date.now() + tokenResponse.expires_in * 1000;

      // Update refresh token if a new one was provided
      if (tokenResponse.refresh_token) {
        this.refreshToken = tokenResponse.refresh_token;
      }
    } catch (error) {
      throw new AnafAuthenticationError(
        `Failed to refresh access token: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  private validateConfig(config: AnafEfacturaClientConfig): void {
    if (!config) {
      throw new AnafValidationError('Configuration is required');
    }

    if (!config.vatNumber?.trim()) {
      throw new AnafValidationError('VAT number is required');
    }

    if (!config.refreshToken?.trim()) {
      throw new AnafValidationError('Refresh token is required for automatic authentication');
    }
  }

  private validateXmlContent(xmlContent: string): void {
    if (!xmlContent?.trim()) {
      throw new AnafValidationError('XML content is required');
    }
  }

  private validateUploadId(uploadId: string): void {
    if (!uploadId?.trim()) {
      throw new AnafValidationError('Upload ID is required');
    }
  }

  private validateDownloadId(downloadId: string): void {
    if (!downloadId?.trim()) {
      throw new AnafValidationError('Download ID is required');
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

  private validateUploadOptions(options: UploadOptions): void {
    if (options.standard && !['UBL', 'CN', 'CII', 'RASP'].includes(options.standard)) {
      throw new AnafValidationError('Standard must be one of: UBL, CN, CII, RASP');
    }
  }

  private validateDocumentStandard(standard: DocumentStandardType): void {
    if (!['FACT1', 'FCN'].includes(standard)) {
      throw new AnafValidationError('Document standard must be FACT1 or FCN');
    }
  }

  private handleApiError(error: any, context: string): never {
    if (error instanceof AnafSdkError) {
      throw error;
    } else {
      // Check if it's an HTTP error with status code
      if (error?.response?.status || error?.status) {
        const status = error.response?.status || error.status;
        const errorMessage = error.message || error.response?.statusText || 'Unknown error';

        switch (status) {
          case 400:
            throw new AnafValidationError(`${context}: Invalid request - ${errorMessage}`);
          case 401:
            throw new AnafAuthenticationError(`${context}: Authentication failed - ${errorMessage}`);
          case 500:
            throw new AnafApiError(`${context}: Server error - ${errorMessage}`, status);
          default:
            throw new AnafApiError(`${context}: HTTP ${status} - ${errorMessage}`, status);
        }
      }

      throw new AnafSdkError(`${context}: ${error.message || 'Unknown error'}`);
    }
  }
}
