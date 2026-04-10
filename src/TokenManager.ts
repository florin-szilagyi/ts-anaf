import { AnafAuthenticationError, AnafValidationError } from './errors';
import { TokenResponse } from './types';
import { AnafAuthenticator } from './AnafAuthenticator';

/**
 * Manages OAuth token lifecycle for ANAF API clients.
 *
 * Uses promise coalescing so concurrent requests share a single in-flight refresh.
 * Inject the same instance into multiple clients to share token state.
 */
export class TokenManager {
  private authenticator: AnafAuthenticator;
  private currentAccessToken?: string;
  private accessTokenExpiresAt?: number;
  private refreshToken: string;
  private tokenRefreshPromise: Promise<void> | null = null;

  constructor(authenticator: AnafAuthenticator, refreshToken: string) {
    if (!refreshToken?.trim()) {
      throw new AnafValidationError('Refresh token is required for automatic authentication');
    }
    this.authenticator = authenticator;
    this.refreshToken = refreshToken;
  }

  /**
   * Get a valid access token, refreshing if necessary.
   * Concurrent callers share a single in-flight refresh.
   */
  async getValidAccessToken(): Promise<string> {
    if (this.isTokenValid()) {
      return this.currentAccessToken!;
    }

    if (this.tokenRefreshPromise) {
      await this.tokenRefreshPromise;
      return this.currentAccessToken!;
    }

    this.tokenRefreshPromise = this.refreshAccessToken().finally(() => {
      this.tokenRefreshPromise = null;
    });

    await this.tokenRefreshPromise;
    return this.currentAccessToken!;
  }

  /** Get the current refresh token (may have rotated since construction) */
  getRefreshToken(): string {
    return this.refreshToken;
  }

  private isTokenValid(): boolean {
    if (!this.currentAccessToken || !this.accessTokenExpiresAt) {
      return false;
    }
    const bufferMs = 30 * 1000;
    return Date.now() < this.accessTokenExpiresAt - bufferMs;
  }

  private async refreshAccessToken(): Promise<void> {
    try {
      const tokenResponse: TokenResponse = await this.authenticator.refreshAccessToken(this.refreshToken);

      this.currentAccessToken = tokenResponse.access_token;
      this.accessTokenExpiresAt = Date.now() + tokenResponse.expires_in * 1000;

      if (tokenResponse.refresh_token) {
        this.refreshToken = tokenResponse.refresh_token;
      }
    } catch (error) {
      throw new AnafAuthenticationError(
        `Failed to refresh access token: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}
