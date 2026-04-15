import { AnafAuthenticator } from '@florinszilagyi/anaf-ts-sdk';
import { CliError } from '../output/errors';
import type { Credential, CredentialService, CompanyService, ConfigStore, TokenRecord, TokenStore, Company, Environment } from '../state';

export interface AuthServiceOptions {
  credentialService: CredentialService;
  companyService: CompanyService;
  configStore: ConfigStore;
  tokenStore: TokenStore;
  authenticatorFactory?: (args: { clientId: string; clientSecret: string; redirectUri: string }) => AnafAuthenticator;
  now?: () => Date;
}

export interface SecretSource {
  flag?: string;
  stdin?: string;
  env?: string;
}

export interface AuthorizationUrlResult {
  credential: Credential;
  url: string;
}

export interface ExchangeCodeArgs {
  code: string;
  secret: SecretSource;
}

export interface RefreshArgs {
  secret: SecretSource;
}

export type TokenStatus = 'fresh' | 'expired' | 'missing';

export interface WhoamiResult {
  company?: Company;
  env: Environment;
  tokenStatus: TokenStatus;
  expiresAt?: string;
  obtainedAt?: string;
}

interface TokenResponseLike {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export const TOKEN_KEY = '_default';

/**
 * Service that wraps the SDK's {@link AnafAuthenticator} behind a CLI-friendly
 * contract and persists rotated refresh tokens through {@link TokenStore}.
 *
 * Single credential, single token. Token key is always `'_default'`.
 */
export class AuthService {
  private readonly credentialService: CredentialService;
  private readonly companyService: CompanyService;
  private readonly configStore: ConfigStore;
  private readonly tokenStore: TokenStore;
  private readonly authenticatorFactory: NonNullable<AuthServiceOptions['authenticatorFactory']>;
  private readonly now: () => Date;

  constructor(opts: AuthServiceOptions) {
    this.credentialService = opts.credentialService;
    this.companyService = opts.companyService;
    this.configStore = opts.configStore;
    this.tokenStore = opts.tokenStore;
    this.authenticatorFactory = opts.authenticatorFactory ?? ((args) => new AnafAuthenticator(args));
    this.now = opts.now ?? ((): Date => new Date());
  }

  /**
   * Resolve the client secret from a {@link SecretSource}, with an optional
   * fallback from the credential file's `clientSecret` field.
   */
  static resolveSecret(source: SecretSource, credentialSecret?: string): string {
    const candidates = [source.flag, source.stdin, source.env, credentialSecret];
    for (const c of candidates) {
      if (typeof c === 'string' && c.length > 0) return c;
    }
    throw new CliError({
      code: 'CLIENT_SECRET_MISSING',
      message: 'OAuth client secret is required. Store it in the credential, set ANAF_CLIENT_SECRET, or pass --client-secret-stdin.',
      category: 'auth',
    });
  }

  /**
   * Build the ANAF OAuth authorization URL using the single credential.
   */
  buildAuthorizationUrl(scope?: string): AuthorizationUrlResult {
    const credential = this.credentialService.get();
    const auth = this.authenticatorFactory({
      clientId: credential.clientId,
      clientSecret: 'unused-for-url',
      redirectUri: credential.redirectUri,
    });
    return { credential, url: auth.getAuthorizationUrl(scope) };
  }

  /**
   * Exchange an authorization code for a token pair, persist the result
   * under the `'_default'` key, and return the persisted {@link TokenRecord}.
   */
  async exchangeCode(args: ExchangeCodeArgs): Promise<TokenRecord> {
    const credential = this.credentialService.get();
    const clientSecret = AuthService.resolveSecret(args.secret, credential.clientSecret);
    const auth = this.authenticatorFactory({
      clientId: credential.clientId,
      clientSecret,
      redirectUri: credential.redirectUri,
    });
    let response: TokenResponseLike;
    try {
      response = await auth.exchangeCodeForToken(args.code);
    } catch (cause) {
      throw new CliError({
        code: 'AUTH_FAILED',
        message: `Failed to exchange code: ${(cause as Error).message}`,
        category: 'auth',
      });
    }
    const record = this.toRecord(response);
    this.tokenStore.write(TOKEN_KEY, record);
    return record;
  }

  /**
   * Refresh the persisted token pair using its stored refresh token.
   */
  async refresh(args: RefreshArgs): Promise<TokenRecord> {
    const credential = this.credentialService.get();
    const existing = this.tokenStore.read(TOKEN_KEY);
    if (!existing?.refreshToken) {
      throw new CliError({
        code: 'NO_REFRESH_TOKEN',
        message: 'No refresh token persisted. Run `anaf-cli auth login <CUI>` first.',
        category: 'auth',
      });
    }
    const clientSecret = AuthService.resolveSecret(args.secret, credential.clientSecret);
    const auth = this.authenticatorFactory({
      clientId: credential.clientId,
      clientSecret,
      redirectUri: credential.redirectUri,
    });
    let response: TokenResponseLike;
    try {
      response = await auth.refreshAccessToken(existing.refreshToken);
    } catch (cause) {
      throw new CliError({
        code: 'AUTH_FAILED',
        message: `Failed to refresh token: ${(cause as Error).message}`,
        category: 'auth',
      });
    }
    const record = this.toRecord(response);
    this.tokenStore.write(TOKEN_KEY, record);
    return record;
  }

  /**
   * Report the active company, environment, and token freshness.
   */
  whoami(): WhoamiResult {
    const env = this.configStore.getEnv();
    const activeCui = this.configStore.getActiveCui();
    let company: Company | undefined;
    if (activeCui) {
      try {
        company = this.companyService.get(activeCui);
      } catch {
        // Company file missing — still report the CUI
        company = { cui: activeCui, name: '(unknown)' };
      }
    }
    const token = this.tokenStore.read(TOKEN_KEY);
    if (!token?.expiresAt) {
      return { company, env, tokenStatus: 'missing' };
    }
    const now = this.now().getTime();
    const exp = Date.parse(token.expiresAt);
    return {
      company,
      env,
      tokenStatus: now < exp ? 'fresh' : 'expired',
      expiresAt: token.expiresAt,
      obtainedAt: token.obtainedAt,
    };
  }

  /**
   * Return the persisted token record, or `null` if none exists.
   */
  getToken(): TokenRecord | null {
    return this.tokenStore.read(TOKEN_KEY) ?? null;
  }

  /**
   * Remove the persisted token file.
   */
  logout(): void {
    this.tokenStore.remove(TOKEN_KEY);
  }

  private toRecord(response: TokenResponseLike): TokenRecord {
    const obtained = this.now();
    const expires = new Date(obtained.getTime() + response.expires_in * 1000);
    return {
      refreshToken: response.refresh_token,
      accessToken: response.access_token,
      obtainedAt: obtained.toISOString(),
      expiresAt: expires.toISOString(),
    };
  }
}
