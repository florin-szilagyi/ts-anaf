import { AnafAuthenticator } from 'anaf-ts-sdk';
import { CliError } from '../output/errors';
import type { Context, ContextService, TokenRecord, TokenStore } from '../state';

export interface AuthServiceOptions {
  contextService: ContextService;
  tokenStore: TokenStore;
  /**
   * Factory for the SDK authenticator. Defaults to constructing a real
   * {@link AnafAuthenticator}. Tests inject a stub.
   */
  authenticatorFactory?: (args: { clientId: string; clientSecret: string; redirectUri: string }) => AnafAuthenticator;
  now?: () => Date;
}

export interface SecretSource {
  flag?: string;
  stdin?: string;
  env?: string;
}

export interface AuthorizationUrlResult {
  context: Context;
  url: string;
}

export interface ExchangeCodeArgs {
  contextName?: string;
  code: string;
  secret: SecretSource;
}

export interface RefreshArgs {
  contextName?: string;
  secret: SecretSource;
}

export type TokenStatus = 'fresh' | 'expired' | 'missing';

export interface WhoamiResult {
  context: Context;
  tokenStatus: TokenStatus;
  expiresAt?: string;
  obtainedAt?: string;
}

interface TokenResponseLike {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Service that wraps the SDK's {@link AnafAuthenticator} behind a CLI-friendly
 * contract and persists rotated refresh tokens through {@link TokenStore}.
 *
 * The client secret is NEVER persisted to disk: it is resolved on each call
 * from a {@link SecretSource} (flag → stdin → env) and then discarded.
 */
export class AuthService {
  private readonly contextService: ContextService;
  private readonly tokenStore: TokenStore;
  private readonly authenticatorFactory: NonNullable<AuthServiceOptions['authenticatorFactory']>;
  private readonly now: () => Date;

  constructor(opts: AuthServiceOptions) {
    this.contextService = opts.contextService;
    this.tokenStore = opts.tokenStore;
    this.authenticatorFactory = opts.authenticatorFactory ?? ((args) => new AnafAuthenticator(args));
    this.now = opts.now ?? ((): Date => new Date());
  }

  /**
   * Resolve the client secret from a {@link SecretSource}. Order of preference:
   * `flag` → `stdin` → `env`. Throws `CliError(CLIENT_SECRET_MISSING)` if all
   * three are absent or empty.
   *
   * Exposed as a static so downstream services (e.g. EfacturaService in P2.4)
   * can share the resolution logic without depending on an instance.
   */
  static resolveSecret(source: SecretSource): string {
    const candidates = [source.flag, source.stdin, source.env];
    for (const c of candidates) {
      if (typeof c === 'string' && c.length > 0) return c;
    }
    throw new CliError({
      code: 'CLIENT_SECRET_MISSING',
      message: 'OAuth client secret is required. Provide it via --client-secret-stdin or set ANAF_CLIENT_SECRET.',
      category: 'auth',
    });
  }

  /**
   * Build the ANAF OAuth authorization URL for the active (or explicitly named)
   * context. Does NOT require a client secret: the SDK only needs `clientId`
   * and `redirectUri` to construct the URL, but its constructor validates that
   * `clientSecret` is non-empty, so we pass a fixed placeholder. The placeholder
   * NEVER leaves the process and is NEVER persisted.
   */
  buildAuthorizationUrl(contextName?: string, scope?: string): AuthorizationUrlResult {
    const context = this.contextService.resolve(contextName);
    const auth = this.authenticatorFactory({
      clientId: context.auth.clientId,
      clientSecret: 'unused-for-url',
      redirectUri: context.auth.redirectUri,
    });
    return { context, url: auth.getAuthorizationUrl(scope) };
  }

  /**
   * Exchange a pasted authorization code for a token pair, persist the result,
   * and return the persisted {@link TokenRecord}. Wraps SDK failures as
   * `CliError(AUTH_FAILED)`.
   */
  async exchangeCode(args: ExchangeCodeArgs): Promise<TokenRecord> {
    const context = this.contextService.resolve(args.contextName);
    const clientSecret = AuthService.resolveSecret(args.secret);
    const auth = this.authenticatorFactory({
      clientId: context.auth.clientId,
      clientSecret,
      redirectUri: context.auth.redirectUri,
    });
    let response: TokenResponseLike;
    try {
      response = await auth.exchangeCodeForToken(args.code);
    } catch (cause) {
      throw new CliError({
        code: 'AUTH_FAILED',
        message: `Failed to exchange code: ${(cause as Error).message}`,
        category: 'auth',
        details: { context: context.name },
      });
    }
    const record = this.toRecord(response);
    this.tokenStore.write(context.name, record);
    return record;
  }

  /**
   * Refresh the persisted token pair using its stored refresh token. Throws
   * `CliError(NO_REFRESH_TOKEN)` if no token is persisted, or
   * `CliError(AUTH_FAILED)` if the SDK call rejects.
   */
  async refresh(args: RefreshArgs): Promise<TokenRecord> {
    const context = this.contextService.resolve(args.contextName);
    const existing = this.tokenStore.read(context.name);
    if (!existing?.refreshToken) {
      throw new CliError({
        code: 'NO_REFRESH_TOKEN',
        message: `No refresh token persisted for context "${context.name}". Run \`anaf-cli auth login\` first.`,
        category: 'auth',
        details: { context: context.name },
      });
    }
    const clientSecret = AuthService.resolveSecret(args.secret);
    const auth = this.authenticatorFactory({
      clientId: context.auth.clientId,
      clientSecret,
      redirectUri: context.auth.redirectUri,
    });
    let response: TokenResponseLike;
    try {
      response = await auth.refreshAccessToken(existing.refreshToken);
    } catch (cause) {
      throw new CliError({
        code: 'AUTH_FAILED',
        message: `Failed to refresh token: ${(cause as Error).message}`,
        category: 'auth',
        details: { context: context.name },
      });
    }
    const record = this.toRecord(response);
    this.tokenStore.write(context.name, record);
    return record;
  }

  /**
   * Report the freshness of the persisted token for the resolved context.
   * A record without `expiresAt` (e.g. refresh-token-only) is reported as
   * `missing` — the user must run `auth refresh` to obtain a usable access token.
   */
  whoami(contextName?: string): WhoamiResult {
    const context = this.contextService.resolve(contextName);
    const token = this.tokenStore.read(context.name);
    if (!token?.expiresAt) {
      return { context, tokenStatus: 'missing' };
    }
    const now = this.now().getTime();
    const exp = Date.parse(token.expiresAt);
    return {
      context,
      tokenStatus: now < exp ? 'fresh' : 'expired',
      expiresAt: token.expiresAt,
      obtainedAt: token.obtainedAt,
    };
  }

  /**
   * Remove the persisted token file for the resolved context. Idempotent:
   * calling it when no token exists is a no-op (does not throw).
   */
  logout(contextName?: string): void {
    const context = this.contextService.resolve(contextName);
    this.tokenStore.remove(context.name);
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
