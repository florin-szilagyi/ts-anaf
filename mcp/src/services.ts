import {
  AnafAuthenticator,
  AnafDetailsClient,
  EfacturaClient,
  EfacturaToolsClient,
  TokenManager,
} from '@florinszilagyi/anaf-ts-sdk';
import type { CliState } from './state.js';
import { writeRotatedRefreshToken } from './state.js';

export interface ServiceDeps {
  state: CliState;
  clientSecret: string;
}

export interface TokenManagerLike {
  getValidAccessToken(): Promise<string>;
  getRefreshToken(): string;
}

export interface BuiltServices {
  details: AnafDetailsClient;
  efactura: EfacturaClient;
  tools: EfacturaToolsClient;
  tokenManager: TokenManagerLike;
  vatNumber: string;
  testMode: boolean;
  persistRotation(): void;
}

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

function selectTokenManager(
  authenticator: AnafAuthenticator,
  state: CliState
): { tokenManager: TokenManagerLike; originalRefreshToken: string } {
  const { token } = state;
  const originalRefreshToken = token.refreshToken;
  const fresh = token.accessToken && token.expiresAt && Date.now() < Date.parse(token.expiresAt) - PROACTIVE_REFRESH_MS;

  if (fresh && token.accessToken) {
    return {
      tokenManager: new CachedTokenManager(token.accessToken, originalRefreshToken),
      originalRefreshToken,
    };
  }

  const tm = new TokenManager(authenticator, originalRefreshToken);
  return {
    tokenManager: tm as unknown as TokenManagerLike,
    originalRefreshToken,
  };
}

export function buildServices(deps: ServiceDeps): BuiltServices {
  const { state, clientSecret } = deps;
  const authenticator = new AnafAuthenticator({
    clientId: state.credential.clientId,
    clientSecret,
    redirectUri: state.credential.redirectUri,
  });

  const { tokenManager, originalRefreshToken } = selectTokenManager(authenticator, state);
  const testMode = state.env === 'test';
  const vatNumber = state.activeCui.replace(/^RO/i, '');

  const efactura = new EfacturaClient({ vatNumber, testMode }, tokenManager as unknown as TokenManager);
  const tools = new EfacturaToolsClient({ testMode }, tokenManager as unknown as TokenManager);
  const details = new AnafDetailsClient();

  const persistRotation = (): void => {
    let current: string;
    try {
      current = tokenManager.getRefreshToken();
    } catch {
      return;
    }
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
