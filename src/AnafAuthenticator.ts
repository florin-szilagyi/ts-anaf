import { AnafAuthConfig, TokenResponse } from './types';
import { AnafAuthenticationError, AnafValidationError } from './errors';
import { OAUTH_AUTHORIZE_URL, OAUTH_TOKEN_URL } from './constants';
import { buildOAuthAuthorizationUrl, encodeOAuthTokenRequest } from './utils/formEncoder';
import { HttpClient } from './utils/httpClient';
import { tryCatch } from './tryCatch';

/**
 * Handles OAuth 2.0 authentication with ANAF e-Factura
 */
export class AnafAuthenticator {
  private config: Required<AnafAuthConfig>;
  private httpClient: HttpClient;

  constructor(config: AnafAuthConfig) {
    this.validateConfig(config);

    this.config = {
      ...config,
      timeout: config.timeout ?? 30000,
    };

    this.httpClient = new HttpClient({
      timeout: this.config.timeout,
    });
  }

  /**
   * Generate OAuth authorization URL for user authentication
   */
  public getAuthorizationUrl(scope?: string): string {
    return buildOAuthAuthorizationUrl(OAUTH_AUTHORIZE_URL, {
      client_id: this.config.clientId,
      response_type: 'code',
      redirect_uri: this.config.redirectUri,
      token_content_type: 'jwt',
      scope,
    });
  }

  /**
   * Exchange authorization code for access and refresh tokens
   */
  public async exchangeCodeForToken(code: string): Promise<TokenResponse> {
    if (!code?.trim()) {
      throw new AnafValidationError('Authorization code is required');
    }

    const formData = encodeOAuthTokenRequest({
      grant_type: 'authorization_code',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      code,
      token_content_type: 'jwt',
    });

    const { data, error } = await tryCatch(
      (async () => {
        const response = await this.httpClient.post<TokenResponse>(OAUTH_TOKEN_URL, formData, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        if (!response.data?.access_token) {
          throw new AnafAuthenticationError('Token response missing access token');
        }

        return response.data;
      })()
    );

    if (error) {
      throw new AnafAuthenticationError('Failed to exchange authorization code for tokens');
    }

    return data;
  }

  /**
   * Refresh access token using refresh token
   */
  public async refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
    if (!refreshToken?.trim()) {
      throw new AnafValidationError('Refresh token is required');
    }

    const formData = encodeOAuthTokenRequest({
      grant_type: 'refresh_token',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      redirect_uri: this.config.redirectUri,
      refresh_token: refreshToken,
      token_content_type: 'jwt',
    });

    const { data, error } = await tryCatch(
      (async () => {
        const response = await this.httpClient.post<TokenResponse>(OAUTH_TOKEN_URL, formData, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        if (!response.data?.access_token) {
          throw new AnafAuthenticationError('Token response missing access token');
        }

        return response.data;
      })()
    );

    if (error) {
      throw new AnafAuthenticationError('Failed to refresh access token');
    }

    return data;
  }

  private validateConfig(config: AnafAuthConfig): void {
    if (!config) {
      throw new AnafValidationError('Configuration is required');
    }

    if (!config.clientId?.trim()) {
      throw new AnafValidationError('OAuth client ID is required');
    }
    if (!config.clientSecret?.trim()) {
      throw new AnafValidationError('OAuth client secret is required');
    }
    if (!config.redirectUri?.trim()) {
      throw new AnafValidationError('OAuth redirect URI is required');
    }
  }
}
