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
} from './types';
import { AnafValidationError } from './errors';
import { AnafAuthenticator } from './AnafAuthenticator';
import { TokenManager } from './TokenManager';
import { EfacturaClient } from './EfacturaClient';
import { EfacturaToolsClient } from './EfacturaToolsClient';
import { HttpClient } from './utils/httpClient';
import { getBasePath, DEFAULT_TIMEOUT } from './constants';

/**
 * Main client for interacting with ANAF e-Factura API
 *
 * @deprecated Use {@link EfacturaClient} and {@link EfacturaToolsClient} directly
 * with a shared {@link TokenManager} for better separation of concerns.
 *
 * This class remains fully functional as a backwards-compatible facade.
 *
 * @example
 * ```typescript
 * // NEW (recommended):
 * const tokenManager = new TokenManager(authenticator, refreshToken);
 * const efactura = new EfacturaClient({ vatNumber: 'RO12345678' }, tokenManager);
 * const tools = new EfacturaToolsClient({ testMode: true }, tokenManager);
 *
 * // OLD (still works):
 * const client = new AnafEfacturaClient(config, authenticator);
 * ```
 */
export class AnafEfacturaClient {
  private efacturaClient: EfacturaClient;
  private toolsClient: EfacturaToolsClient;

  constructor(config: AnafEfacturaClientConfig, authenticator: AnafAuthenticator) {
    if (!config) {
      throw new AnafValidationError('Configuration is required');
    }

    const tokenManager = new TokenManager(authenticator, config.refreshToken);
    const basePath = config.basePath || getBasePath('oauth', config.testMode ?? false);
    const httpClient = new HttpClient({
      baseURL: basePath,
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
    });

    this.efacturaClient = new EfacturaClient(
      {
        vatNumber: config.vatNumber,
        testMode: config.testMode,
        timeout: config.timeout,
        basePath: config.basePath,
      },
      tokenManager,
      httpClient
    );

    this.toolsClient = new EfacturaToolsClient(
      {
        testMode: config.testMode,
        timeout: config.timeout,
        basePath: config.basePath,
      },
      tokenManager,
      httpClient
    );
  }

  public uploadDocument(xmlContent: string, options: UploadOptions = {}): Promise<UploadResponse> {
    return this.efacturaClient.uploadDocument(xmlContent, options);
  }

  public uploadB2CDocument(xmlContent: string, options: UploadOptions = {}): Promise<UploadResponse> {
    return this.efacturaClient.uploadB2CDocument(xmlContent, options);
  }

  public getUploadStatus(uploadId: string): Promise<StatusResponse> {
    return this.efacturaClient.getUploadStatus(uploadId);
  }

  public downloadDocument(downloadId: string): Promise<string> {
    return this.efacturaClient.downloadDocument(downloadId);
  }

  public getMessagesPaginated(params: PaginatedMessagesParams): Promise<PaginatedListMessagesResponse> {
    return this.efacturaClient.getMessagesPaginated(params);
  }

  public getMessages(params: ListMessagesParams): Promise<ListMessagesResponse> {
    return this.efacturaClient.getMessages(params);
  }

  public validateXml(xmlContent: string, standard: DocumentStandardType = 'FACT1'): Promise<ValidationResult> {
    return this.toolsClient.validateXml(xmlContent, standard);
  }

  public validateSignature(
    xmlFile: File | Buffer,
    signatureFile: File | Buffer,
    xmlFileName?: string,
    signatureFileName?: string
  ): Promise<ValidationResult> {
    return this.toolsClient.validateSignature(xmlFile, signatureFile, xmlFileName, signatureFileName);
  }

  public convertXmlToPdf(xmlContent: string, standard: DocumentStandardType = 'FACT1'): Promise<Buffer> {
    return this.toolsClient.convertXmlToPdf(xmlContent, standard);
  }

  public convertXmlToPdfNoValidation(xmlContent: string, standard: DocumentStandardType = 'FACT1'): Promise<Buffer> {
    return this.toolsClient.convertXmlToPdfNoValidation(xmlContent, standard);
  }
}
