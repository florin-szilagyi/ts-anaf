import {
  AnafAuthenticator,
  EfacturaClient,
  EfacturaToolsClient,
  TokenManager,
  type ListMessagesResponse,
  type MessageFilter,
  type PaginatedListMessagesResponse,
  type StatusResponse,
  type UploadOptions,
  type UploadResponse,
  type ValidationResult,
} from '@florinszilagyi/anaf-ts-sdk';
import { CliError } from '../output/errors';
import type { CompanyService, CredentialService, ConfigStore, TokenStore, Environment } from '../state';
import type { LookupService } from './lookupService';
import { TOKEN_KEY } from './authService';

/**
 * Structural subset of the SDK `TokenManager` that the service relies on.
 */
export interface TokenManagerLike {
  getValidAccessToken(): Promise<string>;
  getRefreshToken(): string;
}

export type TokenManagerFactory = (args: {
  authenticator: AnafAuthenticator;
  refreshToken: string;
}) => TokenManagerLike;

export interface EfacturaClientFactoryArgs {
  vatNumber: string;
  testMode: boolean;
  tokenManager: TokenManagerLike;
}

export interface EfacturaClientLike {
  uploadDocument(xml: string, options?: UploadOptions): Promise<UploadResponse>;
  uploadB2CDocument(xml: string, options?: UploadOptions): Promise<UploadResponse>;
  getUploadStatus(uploadId: string): Promise<StatusResponse>;
  downloadDocument(downloadId: string): Promise<string>;
  getMessages(params: { zile: number; filtru?: MessageFilter }): Promise<ListMessagesResponse>;
  getMessagesPaginated(params: {
    startTime: number;
    endTime: number;
    pagina: number;
    filtru?: MessageFilter;
  }): Promise<PaginatedListMessagesResponse>;
}

export interface EfacturaToolsClientLike {
  validateXml(xml: string, standard?: 'FACT1' | 'FCN'): Promise<ValidationResult>;
  validateSignature(
    xmlFile: Buffer | File,
    signatureFile: Buffer | File,
    xmlFileName?: string,
    signatureFileName?: string
  ): Promise<ValidationResult>;
  convertXmlToPdf(xml: string, standard?: 'FACT1' | 'FCN'): Promise<Buffer>;
  convertXmlToPdfNoValidation(xml: string, standard?: 'FACT1' | 'FCN'): Promise<Buffer>;
}

export type EfacturaClientFactory = (args: EfacturaClientFactoryArgs) => EfacturaClientLike;
export type EfacturaToolsClientFactory = (args: {
  testMode: boolean;
  tokenManager: TokenManagerLike;
}) => EfacturaToolsClientLike;

export interface EfacturaServiceOptions {
  companyService: CompanyService;
  credentialService: CredentialService;
  configStore: ConfigStore;
  tokenStore: TokenStore;
  lookupService?: LookupService;
  tokenManagerFactory?: TokenManagerFactory;
  clientFactory?: EfacturaClientFactory;
  toolsFactory?: EfacturaToolsClientFactory;
}

export interface UploadArgs {
  xml: string;
  clientSecret: string;
  isB2C?: boolean;
  options?: UploadOptions;
}

export interface StatusArgs {
  uploadId: string;
  clientSecret: string;
}

export interface DownloadArgs {
  downloadId: string;
  clientSecret: string;
}

export interface MessagesArgs {
  clientSecret: string;
  days?: number;
  filter?: MessageFilter;
  startTime?: number;
  endTime?: number;
  page?: number;
}

export interface ValidateArgs {
  clientSecret: string;
  xml: string;
  standard?: 'FACT1' | 'FCN';
}

export interface ValidateSignatureArgs {
  clientSecret: string;
  xml: Buffer | File;
  signature: Buffer | File;
  xmlFilename?: string;
  signatureFilename?: string;
}

export interface PdfArgs {
  clientSecret: string;
  xml: string;
  standard?: 'FACT1' | 'FCN';
  noValidation?: boolean;
}

/** Proactive refresh threshold: refresh when the access token expires within this window. */
const PROACTIVE_REFRESH_MS = 24 * 60 * 60 * 1000; // 1 day

/**
 * Minimal TokenManagerLike that returns a pre-resolved access token directly.
 * Used when the stored access token is still fresh — avoids a network call.
 */
class CachedTokenManager implements TokenManagerLike {
  constructor(
    private readonly _accessToken: string,
    private readonly _refreshToken: string
  ) {}
  async getValidAccessToken(): Promise<string> {
    return this._accessToken;
  }
  getRefreshToken(): string {
    return this._refreshToken;
  }
}

/**
 * CLI-side wrapper around the SDK's `EfacturaClient` and `EfacturaToolsClient`.
 *
 * Reads the active company CUI from ConfigStore and the single credential
 * to build authenticated SDK clients. Token persistence uses key `'_default'`.
 */
export class EfacturaService {
  private readonly companyService: CompanyService;
  private readonly credentialService: CredentialService;
  private readonly configStore: ConfigStore;
  private readonly tokenStore: TokenStore;
  private readonly lookupService?: LookupService;
  private readonly tokenManagerFactory: TokenManagerFactory;
  private readonly clientFactory: EfacturaClientFactory;
  private readonly toolsFactory: EfacturaToolsClientFactory;

  constructor(opts: EfacturaServiceOptions) {
    this.companyService = opts.companyService;
    this.credentialService = opts.credentialService;
    this.configStore = opts.configStore;
    this.tokenStore = opts.tokenStore;
    this.lookupService = opts.lookupService;
    this.tokenManagerFactory =
      opts.tokenManagerFactory ??
      (({ authenticator, refreshToken }): TokenManagerLike =>
        new TokenManager(authenticator, refreshToken) as unknown as TokenManagerLike);
    this.clientFactory =
      opts.clientFactory ??
      (({ vatNumber, testMode, tokenManager }): EfacturaClientLike =>
        new EfacturaClient({ vatNumber, testMode }, tokenManager as unknown as TokenManager));
    this.toolsFactory =
      opts.toolsFactory ??
      (({ testMode, tokenManager }): EfacturaToolsClientLike =>
        new EfacturaToolsClient({ testMode }, tokenManager as unknown as TokenManager));
  }

  async upload(args: UploadArgs): Promise<UploadResponse> {
    return this.withClient(args.clientSecret, async (client) => {
      try {
        return args.isB2C
          ? await client.uploadB2CDocument(args.xml, args.options)
          : await client.uploadDocument(args.xml, args.options);
      } catch (cause) {
        throw wrapAnafError('UPLOAD_FAILED', 'Failed to upload document', cause);
      }
    });
  }

  async getStatus(args: StatusArgs): Promise<StatusResponse> {
    return this.withClient(args.clientSecret, async (client) => {
      try {
        return await client.getUploadStatus(args.uploadId);
      } catch (cause) {
        throw wrapAnafError('STATUS_FAILED', 'Failed to fetch upload status', cause);
      }
    });
  }

  async download(args: DownloadArgs): Promise<Buffer> {
    return this.withClient(args.clientSecret, async (client) => {
      let base64: string;
      try {
        base64 = await client.downloadDocument(args.downloadId);
      } catch (cause) {
        throw wrapAnafError('DOWNLOAD_FAILED', 'Failed to download document', cause);
      }
      return Buffer.from(base64, 'base64');
    });
  }

  async getMessages(args: MessagesArgs): Promise<ListMessagesResponse | PaginatedListMessagesResponse> {
    const paginated = args.startTime !== undefined && args.endTime !== undefined && args.page !== undefined;
    const simple = args.days !== undefined;
    if (!paginated && !simple) {
      throw new CliError({
        code: 'BAD_USAGE',
        message: 'efactura messages: provide either --days OR (--start-time, --end-time, --page)',
        category: 'user_input',
      });
    }
    const response = await this.withClient(args.clientSecret, async (client) => {
      try {
        if (paginated) {
          return await client.getMessagesPaginated({
            startTime: args.startTime as number,
            endTime: args.endTime as number,
            pagina: args.page as number,
            filtru: args.filter,
          });
        }
        return await client.getMessages({ zile: args.days as number, filtru: args.filter });
      } catch (cause) {
        throw wrapAnafError('MESSAGES_FAILED', 'Failed to list messages', cause);
      }
    });

    return this.enrichMessages(response);
  }

  private async enrichMessages<T extends ListMessagesResponse | PaginatedListMessagesResponse>(
    response: T
  ): Promise<T> {
    if (!this.lookupService || !response.mesaje || response.mesaje.length === 0) {
      return response;
    }

    const cuiSet = new Set<string>();
    for (const m of response.mesaje) {
      if (m.cif_emitent) cuiSet.add(m.cif_emitent);
      if (m.cif_beneficiar) cuiSet.add(m.cif_beneficiar);
    }

    if (cuiSet.size === 0) {
      return response;
    }

    try {
      const companies = await this.lookupService.batchGetCompanies([...cuiSet]);
      const nameMap = new Map<string, string>();
      for (const company of companies) {
        nameMap.set(company.vatCode, company.name);
      }

      return {
        ...response,
        mesaje: response.mesaje.map((msg) => ({
          ...msg,
          emitentName: (msg.cif_emitent && nameMap.get(msg.cif_emitent)) || undefined,
          beneficiarName: (msg.cif_beneficiar && nameMap.get(msg.cif_beneficiar)) || undefined,
        })),
      };
    } catch {
      // Graceful degradation — return un-enriched response
      return response;
    }
  }

  async validateXml(args: ValidateArgs): Promise<ValidationResult> {
    return this.withTools(args.clientSecret, async (tools) => {
      try {
        return await tools.validateXml(args.xml, args.standard ?? 'FACT1');
      } catch (cause) {
        throw wrapAnafError('VALIDATION_FAILED', 'Failed to validate XML', cause);
      }
    });
  }

  async validateSignature(args: ValidateSignatureArgs): Promise<ValidationResult> {
    return this.withTools(args.clientSecret, async (tools) => {
      try {
        return await tools.validateSignature(args.xml, args.signature, args.xmlFilename, args.signatureFilename);
      } catch (cause) {
        throw wrapAnafError('SIGNATURE_VALIDATION_FAILED', 'Failed to validate signature', cause);
      }
    });
  }

  async convertToPdf(args: PdfArgs): Promise<Buffer> {
    return this.withTools(args.clientSecret, async (tools) => {
      try {
        if (args.noValidation) {
          return await tools.convertXmlToPdfNoValidation(args.xml, args.standard ?? 'FACT1');
        }
        return await tools.convertXmlToPdf(args.xml, args.standard ?? 'FACT1');
      } catch (cause) {
        throw wrapAnafError('PDF_CONVERSION_FAILED', 'Failed to convert XML to PDF', cause);
      }
    });
  }

  // ─── internals ───────────────────────────────────────────────────────

  private resolveActiveCompany(): { cui: string; env: Environment } {
    const config = this.configStore.read();
    const activeCui = config.activeCui;
    if (!activeCui) {
      throw new CliError({
        code: 'NO_ACTIVE_COMPANY',
        message: 'No active company. Run `anaf-cli auth login <CUI>` or `anaf-cli auth use <CUI>` first.',
        category: 'local_state',
      });
    }
    // Validate company exists
    this.companyService.get(activeCui);
    return { cui: activeCui, env: config.env ?? 'test' };
  }

  private resolveEnv(): Environment {
    return this.configStore.getEnv();
  }

  private async withClient<T>(clientSecret: string, fn: (client: EfacturaClientLike) => Promise<T>): Promise<T> {
    const { cui, env } = this.resolveActiveCompany();
    const credential = this.credentialService.get();
    const authenticator = this.buildAuthenticator(credential.clientId, clientSecret, credential.redirectUri);
    const { tokenManager, originalRefreshToken } = this.selectTokenManager(authenticator);

    const client = this.clientFactory({
      vatNumber: cui.replace(/^RO/i, ''),
      testMode: env === 'test',
      tokenManager,
    });

    try {
      return await fn(client);
    } finally {
      this.persistRotation(tokenManager, originalRefreshToken);
    }
  }

  private async withTools<T>(clientSecret: string, fn: (tools: EfacturaToolsClientLike) => Promise<T>): Promise<T> {
    const env = this.resolveEnv();
    const credential = this.credentialService.get();
    const authenticator = this.buildAuthenticator(credential.clientId, clientSecret, credential.redirectUri);
    const { tokenManager, originalRefreshToken } = this.selectTokenManager(authenticator);

    const tools = this.toolsFactory({
      testMode: env === 'test',
      tokenManager,
    });

    try {
      return await fn(tools);
    } finally {
      this.persistRotation(tokenManager, originalRefreshToken);
    }
  }

  /**
   * Pick the right token manager based on what's stored on disk:
   * - Fresh access token (>1 day from expiry): return a `CachedTokenManager` — zero network calls.
   * - Expiring or missing access token: fall back to `tokenManagerFactory`, which will refresh lazily.
   */
  private selectTokenManager(authenticator: AnafAuthenticator): {
    tokenManager: TokenManagerLike;
    originalRefreshToken: string;
  } {
    const record = this.tokenStore.read(TOKEN_KEY);
    if (!record?.refreshToken) {
      throw new CliError({
        code: 'NO_REFRESH_TOKEN',
        message: 'No refresh token. Run `anaf-cli auth login <CUI>` first.',
        category: 'auth',
      });
    }
    const { refreshToken } = record;

    if (record.accessToken && record.expiresAt && Date.now() < Date.parse(record.expiresAt) - PROACTIVE_REFRESH_MS) {
      return {
        tokenManager: new CachedTokenManager(record.accessToken, refreshToken),
        originalRefreshToken: refreshToken,
      };
    }

    // Token missing or expiring within 1 day — let TokenManager handle refresh.
    return {
      tokenManager: this.tokenManagerFactory({ authenticator, refreshToken }),
      originalRefreshToken: refreshToken,
    };
  }

  private buildAuthenticator(clientId: string, clientSecret: string, redirectUri: string): AnafAuthenticator {
    return new AnafAuthenticator({ clientId, clientSecret, redirectUri });
  }

  private persistRotation(tokenManager: TokenManagerLike, originalRefreshToken: string): void {
    let finalRefreshToken: string;
    try {
      finalRefreshToken = tokenManager.getRefreshToken();
    } catch {
      return;
    }
    if (finalRefreshToken && finalRefreshToken !== originalRefreshToken) {
      this.tokenStore.setRefreshToken(TOKEN_KEY, finalRefreshToken);
    }
  }
}

function wrapAnafError(code: string, summary: string, cause: unknown): CliError {
  const message = cause instanceof Error ? `${summary}: ${cause.message}` : summary;
  return new CliError({
    code,
    message,
    category: 'anaf_api',
    details: cause instanceof Error ? { cause: cause.message } : undefined,
  });
}
