import {
  AnafAuthenticator,
  AnafDetailsClient,
  EfacturaClient,
  EfacturaToolsClient,
  TokenManager,
} from '@florinszilagyi/anaf-ts-sdk';
import type { CliState } from './state.js';
import { writeRotatedRefreshToken } from './state.js';

export interface TokenManagerLike {
  getValidAccessToken(): Promise<string>;
  getRefreshToken(): string;
}

export interface TokenManagerFactoryArgs {
  authenticator: AnafAuthenticator;
  refreshToken: string;
}

export type TokenManagerFactory = (args: TokenManagerFactoryArgs) => TokenManagerLike;

export interface ServiceDeps {
  state: CliState;
  clientSecret: string;
  /** Override for tests. Defaults to {@link Date.now}. */
  now?: () => number;
  /** Override for tests. Defaults to constructing the SDK's real {@link TokenManager}. */
  tokenManagerFactory?: TokenManagerFactory;
}

export interface BuiltServices {
  details: AnafDetailsClient;
  efactura: EfacturaClient;
  tools: EfacturaToolsClient;
  tokenManager: TokenManagerLike;
  vatNumber: string;
  testMode: boolean;
  /** Write the tokenManager's current refresh token to disk if it differs from the one we started with. */
  persistRotation(): void;
}

/** Refresh when the access token expires within this window. */
const PROACTIVE_REFRESH_MS = 24 * 60 * 60 * 1000;

class CachedTokenManager implements TokenManagerLike {
  constructor(
    private readonly accessToken: string,
    private readonly refreshToken: string
  ) {}
  async getValidAccessToken(): Promise<string> {
    return this.accessToken;
  }
  getRefreshToken(): string {
    return this.refreshToken;
  }
}

/**
 * The SDK's concrete `TokenManager` and our `CachedTokenManager` share the
 * structural surface the SDK clients actually call (`getValidAccessToken`).
 * Casting through `unknown` is a single-point-of-contact for that bridge.
 */
function asTokenManager(tm: TokenManagerLike): TokenManager {
  return tm as unknown as TokenManager;
}

function isAccessTokenFresh(expiresAt: string | undefined, now: () => number): boolean {
  if (!expiresAt) return false;
  const exp = Date.parse(expiresAt);
  if (Number.isNaN(exp)) return false;
  return now() < exp - PROACTIVE_REFRESH_MS;
}

function selectTokenManager(
  authenticator: AnafAuthenticator,
  state: CliState,
  now: () => number,
  factory: TokenManagerFactory
): { tokenManager: TokenManagerLike; originalRefreshToken: string } {
  const { token } = state;
  const originalRefreshToken = token.refreshToken;

  if (token.accessToken && isAccessTokenFresh(token.expiresAt, now)) {
    return {
      tokenManager: new CachedTokenManager(token.accessToken, originalRefreshToken),
      originalRefreshToken,
    };
  }

  return {
    tokenManager: factory({ authenticator, refreshToken: originalRefreshToken }),
    originalRefreshToken,
  };
}

const defaultTokenManagerFactory: TokenManagerFactory = ({ authenticator, refreshToken }) =>
  new TokenManager(authenticator, refreshToken) as unknown as TokenManagerLike;

export function buildServices(deps: ServiceDeps): BuiltServices {
  const { state, clientSecret } = deps;
  const now = deps.now ?? Date.now;
  const factory = deps.tokenManagerFactory ?? defaultTokenManagerFactory;

  const authenticator = new AnafAuthenticator({
    clientId: state.credential.clientId,
    clientSecret,
    redirectUri: state.credential.redirectUri,
  });

  const { tokenManager, originalRefreshToken } = selectTokenManager(authenticator, state, now, factory);
  const testMode = state.env === 'test';
  const vatNumber = state.activeCui.replace(/^RO/i, '');

  const sdkTokenManager = asTokenManager(tokenManager);
  const efactura = new EfacturaClient({ vatNumber, testMode }, sdkTokenManager);
  const tools = new EfacturaToolsClient({ testMode }, sdkTokenManager);
  const details = new AnafDetailsClient();

  const persistRotation = (): void => {
    const current = tokenManager.getRefreshToken();
    if (current && current !== originalRefreshToken) {
      writeRotatedRefreshToken(state.paths, current);
    }
  };

  return {
    details,
    efactura,
    tools,
    tokenManager,
    vatNumber,
    testMode,
    persistRotation,
  };
}

/**
 * Build services, run `fn`, and persist any rotated refresh token on the way
 * out — whether `fn` resolves or rejects. Handlers (Tasks 4–10) should use
 * this wrapper instead of calling `persistRotation()` manually.
 */
export async function withServices<T>(deps: ServiceDeps, fn: (services: BuiltServices) => Promise<T>): Promise<T> {
  const services = buildServices(deps);
  try {
    return await fn(services);
  } finally {
    services.persistRotation();
  }
}
