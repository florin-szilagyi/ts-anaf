import { EfacturaToolsConfig, DocumentStandardType, ValidationResult } from './types';
import { AnafValidationError, AnafApiError } from './errors';
import { getBasePath, DEFAULT_TIMEOUT } from './constants';
import { parseJsonResponse } from './utils/xmlParser';
import { HttpClient } from './utils/httpClient';
import { handleApiError } from './utils/errorHandler';
import { tryCatch } from './tryCatch';
import { TokenManager } from './TokenManager';

/**
 * Client for e-Factura validation and conversion utilities.
 *
 * Provides XML validation, digital signature validation, and XML-to-PDF conversion.
 * Does not require a VAT number — only OAuth authentication.
 *
 * @example
 * ```typescript
 * import { EfacturaToolsClient, TokenManager, AnafAuthenticator } from 'efactura-ts-sdk';
 *
 * const authenticator = new AnafAuthenticator({ clientId, clientSecret, redirectUri });
 * const tokenManager = new TokenManager(authenticator, refreshToken);
 *
 * const tools = new EfacturaToolsClient({ testMode: true }, tokenManager);
 *
 * const result = await tools.validateXml(xmlContent, 'FACT1');
 * const pdf = await tools.convertXmlToPdf(xmlContent);
 * ```
 */
export class EfacturaToolsClient {
  private httpClient: HttpClient;
  private tokenManager: TokenManager;

  constructor(config: EfacturaToolsConfig = {}, tokenManager: TokenManager, httpClient?: HttpClient) {
    const basePath = config.basePath || getBasePath('oauth', config.testMode ?? false);

    this.httpClient = httpClient ?? new HttpClient({
      baseURL: basePath,
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
    });

    this.tokenManager = tokenManager;
  }

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  async validateXml(xmlContent: string, standard: DocumentStandardType = 'FACT1'): Promise<ValidationResult> {
    this.validateXmlContent(xmlContent);
    this.validateDocumentStandard(standard);

    const url = `/validare/${standard}`;

    const { data, error } = await tryCatch(async () => {
      const accessToken = await this.tokenManager.getValidAccessToken();
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
      handleApiError(error, 'Failed to validate XML');
    }

    return data;
  }

  async validateSignature(
    xmlFile: File | Buffer,
    signatureFile: File | Buffer,
    xmlFileName?: string,
    signatureFileName?: string
  ): Promise<ValidationResult> {
    const url = `/api/validate/signature`;

    const formData = new FormData();

    if (typeof File !== 'undefined' && xmlFile instanceof File) {
      formData.append('file', xmlFile);
    } else if (xmlFile instanceof Buffer) {
      if (!xmlFileName) {
        throw new AnafValidationError('XML file name is required when uploading Buffer');
      }
      const blob = new Blob([xmlFile], { type: 'text/xml' });
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
      const blob = new Blob([signatureFile], { type: 'application/octet-stream' });
      formData.append('signature', blob, signatureFileName);
    } else {
      throw new AnafValidationError('Invalid signature file type. Expected File or Buffer');
    }

    const { data, error } = await tryCatch(async () => {
      const accessToken = await this.tokenManager.getValidAccessToken();
      const response = await this.httpClient.post(url, formData, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      const responseData = response.data;
      const msg = responseData.msg || '';

      return {
        valid: msg.includes('validate cu succes') && !msg.includes('NU'),
        details: msg,
      };
    });

    if (error) {
      handleApiError(error, 'Failed to validate signature');
    }

    return data;
  }

  // ==========================================================================
  // CONVERSION
  // ==========================================================================

  async convertXmlToPdf(xmlContent: string, standard: DocumentStandardType = 'FACT1'): Promise<Buffer> {
    this.validateXmlContent(xmlContent);
    this.validateDocumentStandard(standard);

    const url = `/transformare/${standard}`;
    return this.performPdfConversion(url, xmlContent, 'Failed to convert XML to PDF');
  }

  async convertXmlToPdfNoValidation(xmlContent: string, standard: DocumentStandardType = 'FACT1'): Promise<Buffer> {
    this.validateXmlContent(xmlContent);
    this.validateDocumentStandard(standard);

    const url = `/transformare/${standard}/DA`;
    return this.performPdfConversion(url, xmlContent, 'Failed to convert XML to PDF without validation');
  }

  // ==========================================================================
  // PRIVATE
  // ==========================================================================

  private async performPdfConversion(url: string, xmlContent: string, errorContext: string): Promise<Buffer> {
    const { data, error } = await tryCatch(async () => {
      const accessToken = await this.tokenManager.getValidAccessToken();
      const response = await this.httpClient.post(url, xmlContent, {
        headers: {
          'Content-Type': 'text/plain',
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (response.headers?.get('content-type')?.includes('application/json')) {
        const errorData = parseJsonResponse(response.data);
        throw new AnafApiError(
          errorData.Messages ? errorData.Messages.map((m: any) => m.message).join('\n') : 'PDF conversion failed'
        );
      }

      if (response.data instanceof ArrayBuffer) {
        return Buffer.from(response.data);
      }
      return Buffer.from(response.data as any);
    });

    if (error) {
      handleApiError(error, errorContext);
    }

    return data;
  }

  private validateXmlContent(xmlContent: string): void {
    if (!xmlContent?.trim()) {
      throw new AnafValidationError('XML content is required');
    }
  }

  private validateDocumentStandard(standard: DocumentStandardType): void {
    if (!['FACT1', 'FCN'].includes(standard)) {
      throw new AnafValidationError('Document standard must be FACT1 or FCN');
    }
  }
}
