import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { AnafEfacturaClient } from '../src';
import { AnafAuthenticator } from '../src/AnafAuthenticator';
import { TokenResponse } from '../src/types';
import { AnafValidationError } from '../src/errors';
import { createOAuthCallbackServer, OAuthCallbackData } from './oauth-server';
import { tryCatch } from '../src/tryCatch';

// Load environment variables
dotenv.config();

describe('ANAF OAuth Authentication & API Client', () => {
  let authenticator: AnafAuthenticator;
  let client: AnafEfacturaClient;
  let oauthServer: ReturnType<typeof createOAuthCallbackServer>;
  const tokenFilePath = path.join(process.cwd(), 'token.secret');
  const PORT = 4040;

  // Store captured auth data
  let capturedAuthCode: string | null = null;
  let authCodePromise: Promise<string> | null = null;
  let authCodeResolve: ((code: string) => void) | null = null;

  beforeAll(async () => {
    // Validate environment variables
    if (!process.env.ANAF_CLIENT_ID || !process.env.ANAF_CLIENT_SECRET) {
      throw new Error('Missing ANAF_CLIENT_ID or ANAF_CLIENT_SECRET environment variables');
    }

    // Create authenticator for OAuth operations
    authenticator = new AnafAuthenticator({
      clientId: process.env.ANAF_CLIENT_ID!,
      clientSecret: process.env.ANAF_CLIENT_SECRET!,
      redirectUri: process.env.ANAF_CALLBACK_URL!,
    });

    // Create client for API operations
    client = new AnafEfacturaClient(
      {
        vatNumber: 'RO12345678', // Test VAT number
        testMode: true, // Use test environment
        refreshToken: 'dummy-refresh-token', // Will be updated when we get real tokens
      },
      authenticator
    );

    // Setup OAuth callback server
    oauthServer = createOAuthCallbackServer();

    // Set callback handler
    oauthServer.setCallbackHandler((data: OAuthCallbackData) => {
      const { code, error } = data;

      console.log('\n📥 Callback received:', {
        code: code ? `${code.substring(0, 20)}...` : 'none',
        error: error || 'none',
        hasResolver: !!authCodeResolve,
      });

      if (code) {
        capturedAuthCode = code;

        // Resolve the promise if waiting
        if (authCodeResolve) {
          console.log('🔗 Resolving authorization code promise...');
          authCodeResolve(code);
          authCodeResolve = null;
        } else {
          console.log('⚠️ No promise resolver available - test may not be waiting yet');
        }
      }
    });

    // Start server
    await oauthServer.start(PORT);
  });

  afterAll(async () => {
    if (oauthServer) {
      oauthServer.stop();
    }
  });

  describe('Authenticator Configuration', () => {
    test('should create authenticator with valid configuration', () => {
      expect(authenticator).toBeDefined();
      expect(() => {
        new AnafAuthenticator({
          clientId: process.env.ANAF_CLIENT_ID!,
          clientSecret: process.env.ANAF_CLIENT_SECRET!,
          redirectUri: process.env.ANAF_CALLBACK_URL!,
        });
      }).not.toThrow();
    });

    test('should throw error for missing client ID', () => {
      expect(() => {
        new AnafAuthenticator({
          clientId: '',
          clientSecret: 'secret',
          redirectUri: process.env.ANAF_CALLBACK_URL!,
        });
      }).toThrow(AnafValidationError);
    });

    test('should throw error for missing client secret', () => {
      expect(() => {
        new AnafAuthenticator({
          clientId: 'client-id',
          clientSecret: '',
          redirectUri: process.env.ANAF_CALLBACK_URL!,
        });
      }).toThrow(AnafValidationError);
    });

    test('should throw error for missing redirect URI', () => {
      expect(() => {
        new AnafAuthenticator({
          clientId: 'client-id',
          clientSecret: 'secret',
          redirectUri: '',
        });
      }).toThrow(AnafValidationError);
    });
  });

  describe('Client Configuration', () => {
    test('should create client with valid configuration', () => {
      expect(client).toBeDefined();
      expect(() => {
        const testAuthenticator = new AnafAuthenticator({
          clientId: 'test-client-id',
          clientSecret: 'test-secret',
          redirectUri: 'http://localhost:3000/callback',
        });
        new AnafEfacturaClient(
          {
            vatNumber: 'RO12345678',
            testMode: true,
            refreshToken: 'test-refresh-token',
          },
          testAuthenticator
        );
      }).not.toThrow();
    });
  });

  describe('Authorization URL Generation', () => {
    test('should generate valid authorization URL', () => {
      const authUrl = authenticator.getAuthorizationUrl();

      expect(authUrl).toContain('https://logincert.anaf.ro/anaf-oauth2/v1/authorize');
      expect(authUrl).toContain(`client_id=${process.env.ANAF_CLIENT_ID}`);
      expect(authUrl).toContain('response_type=code');
      expect(authUrl).toContain(`redirect_uri=${encodeURIComponent(process.env.ANAF_CALLBACK_URL!)}`);
      expect(authUrl).toContain('token_content_type=jwt');
    });

    test('should generate authorization URL with scope parameter', () => {
      const scope = 'test-scope';
      const authUrl = authenticator.getAuthorizationUrl(scope);

      expect(authUrl).toContain(`scope=${scope}`);
    });
  });

  describe('Token Exchange Validation', () => {
    test('should throw error for empty authorization code', async () => {
      await expect(authenticator.exchangeCodeForToken('')).rejects.toThrow(AnafValidationError);
      await expect(authenticator.exchangeCodeForToken('   ')).rejects.toThrow(AnafValidationError);
    });

    test('should throw error for null/undefined authorization code', async () => {
      await expect(authenticator.exchangeCodeForToken(null as any)).rejects.toThrow(AnafValidationError);
      await expect(authenticator.exchangeCodeForToken(undefined as any)).rejects.toThrow(AnafValidationError);
    });
  });

  describe('Token Refresh Validation', () => {
    test('should throw error for empty refresh token', async () => {
      await expect(authenticator.refreshAccessToken('')).rejects.toThrow(AnafValidationError);
      await expect(authenticator.refreshAccessToken('   ')).rejects.toThrow(AnafValidationError);
    });

    test('should throw error for null/undefined refresh token', async () => {
      await expect(authenticator.refreshAccessToken(null as any)).rejects.toThrow(AnafValidationError);
      await expect(authenticator.refreshAccessToken(undefined as any)).rejects.toThrow(AnafValidationError);
    });
  });

  describe('Manual OAuth Flow', () => {
    test('should complete full OAuth flow with automatic browser opening', async () => {
      // Skip if we already have valid tokens
      const existingTokens = await loadTokens();
      if (existingTokens && existingTokens.refresh_token && !isTokenExpired(existingTokens)) {
        console.log('✅ Valid tokens already exist, skipping manual OAuth flow');
        return;
      }

      console.log(
        '\n🔗 MANUAL OAUTH AUTHENTICATION REQUIRED\n' +
          '=============================================\n' +
          '📋 Instructions:\n' +
          '1. Make sure your USB token is connected\n' +
          '2. Browser will open automatically\n' +
          '3. Insert USB token and enter PIN when prompted\n' +
          '4. Authorize the application\n' +
          '5. The browser will redirect to localhost:4040/callback\n' +
          '6. The test will automatically capture the authorization code'
      );

      const authUrl = authenticator.getAuthorizationUrl();

      console.log(
        '\n🌐 OAuth Authorization URL:\n' +
          authUrl +
          '\n' +
          `🔐 ANAF will redirect to: ${process.env.ANAF_CALLBACK_URL}\n` +
          `🔧 Local server running on: http://localhost:${PORT}/callback\n` +
          `💡 Make sure your ngrok tunnel forwards ${process.env.ANAF_CALLBACK_URL} to http://localhost:${PORT}/callback`
      );

      // Validate URL structure
      expect(authUrl).toBeTruthy();
      expect(authUrl).toContain('https://logincert.anaf.ro/anaf-oauth2/v1/authorize');
      expect(authUrl).toContain(`client_id=${process.env.ANAF_CLIENT_ID}`);
      expect(authUrl).toContain('response_type=code');
      expect(authUrl).toContain('token_content_type=jwt');
      expect(authUrl).toContain(`redirect_uri=${encodeURIComponent(process.env.ANAF_CALLBACK_URL!)}`);

      console.log('✅ OAuth URL validation passed');

      // Setup promise to wait for authorization code BEFORE opening browser
      authCodePromise = new Promise<string>((resolve) => {
        authCodeResolve = resolve;
      });

      // Automatically open browser
      console.log(`🌐 Opening ${authUrl}`);
      let { error } = tryCatch(async () => {
        await openBrowser(authUrl);
        console.log('✅ Browser opened successfully');
      });
      if (error) {
        console.error('⚠️ Failed to open browser automatically: ', error);
        console.log('💡 Please manually copy and paste the URL above into your browser');
      }

      console.log(
        '\n⏳ Waiting for OAuth authorization...\n' +
          '💡 Complete the OAuth flow in your browser to continue this test\n' +
          '💡 Insert your USB token and enter PIN when prompted by ANAF'
      );

      // Wait for auth code with timeout
      const timeoutMs = 180000; // 3 minutes for USB token interaction

      const { data, error: authCodeError } = tryCatch(async () => {
        return await Promise.race([
          await Promise.race([
            authCodePromise,
            new Promise<never>((_, reject) => {
              const timeoutId = setTimeout(() => reject(new Error('OAuth timeout')), timeoutMs);
              authCodePromise?.then(() => clearTimeout(timeoutId)).catch(() => clearTimeout(timeoutId));
            }),
          ]),
        ]);
      });
      const authCode = await data;
      if (authCodeError || !authCode) {
        console.error('⚠️ Error while waiting for OAuth authorization:', authCodeError);
        throw authCodeError;
      }

      console.log('\n🔄 Exchanging authorization code for tokens...');

      const { data: tokens, error: exchangeError } = tryCatch(async () => {
        const tokens = await authenticator.exchangeCodeForToken(authCode);

        expect(tokens).toBeDefined();
        expect(tokens.access_token).toBeTruthy();
        expect(tokens.refresh_token).toBeTruthy();
        expect(tokens.expires_in).toBeGreaterThan(0);
        expect(tokens.token_type).toBe('Bearer');

        // Save tokens for future tests
        await saveTokens(tokens);

        console.log(
          '✅ Token exchange successful!\n' +
            `🔑 Access token: ${tokens.access_token.substring(0, 30)}...\n` +
            `🔄 Refresh token: ${tokens.refresh_token.substring(0, 30)}...\n` +
            `⏰ Expires in: ${tokens.expires_in} seconds (${Math.round(tokens.expires_in / 60)} minutes)\n` +
            `💾 Tokens saved to: ${tokenFilePath}`
        );
      });
      if (exchangeError) {
        console.error(`❌ Token exchange failed: ${exchangeError}`);
        throw exchangeError;
      }
    }, 200000); // 3.5 minute timeout for Jest
  });

  describe('Token Refresh', () => {
    test('should refresh access token if tokens exist', async () => {
      const tokens = await loadTokens();

      if (!tokens || !tokens.refresh_token) {
        console.log('\n⚠️ SKIPPING: No refresh token found. Complete OAuth flow first.');
        return;
      }

      console.log('\n🔄 Testing token refresh...');

      const { data: newTokens, error: refreshError } = tryCatch(async () => {
        const newTokens = await authenticator.refreshAccessToken(tokens.refresh_token);

        expect(newTokens).toBeDefined();
        expect(newTokens.access_token).toBeTruthy();
        expect(newTokens.refresh_token).toBeTruthy();
        expect(newTokens.expires_in).toBeGreaterThan(0);
        expect(newTokens.token_type).toBe('Bearer');

        // Should be different from original
        expect(newTokens.access_token).not.toBe(tokens.access_token);

        // Save updated tokens
        await saveTokens(newTokens);

        console.log(
          '✅ Token refresh successful!\n' +
            `🔑 New access token: ${newTokens.access_token.substring(0, 30)}...\n` +
            `🔄 New refresh token: ${newTokens.refresh_token.substring(0, 30)}...\n` +
            `⏰ Expires in: ${newTokens.expires_in} seconds\n` +
            `💾 Updated tokens saved to: ${tokenFilePath}`
        );
      });
      if (refreshError) {
        console.error(`❌ Token refresh failed: ${refreshError}`);
        throw refreshError;
      }
    });
  });

  describe('API Client Integration', () => {
    test('should demonstrate separation of concerns', async () => {
      const tokens = await loadTokens();

      if (!tokens || !tokens.access_token) {
        console.log('\n⚠️ SKIPPING: No access token found. Complete OAuth flow first.');
        return;
      }

      console.log('\n🔧 Testing API client with authenticated token...');

      // This demonstrates how the API client uses tokens from the authenticator
      // For now, we'll just validate that the client is configured correctly
      expect(client).toBeDefined();

      // You could add actual API calls here when you have test data:
      // const uploadResult = await client.uploadDocument(tokens.access_token, xmlContent);
      // const messages = await client.getMessages(tokens.access_token, { zile: 7 });

      console.log('✅ API client is ready to use with access token');
      console.log('💡 Available API methods:');
      console.log('   - uploadDocument(token, xml, options)');
      console.log('   - uploadB2CDocument(token, xml, options)');
      console.log('   - getUploadStatus(token, uploadId)');
      console.log('   - downloadDocument(token, downloadId)');
      console.log('   - getMessages(token, params)');
      console.log('   - getMessagesPaginated(token, params)');
      console.log('   - validateXml(token, xml, standard)');
      console.log('   - validateSignature(token, xmlFile, signatureFile)');
      console.log('   - convertXmlToPdf(token, xml, standard)');
      console.log('   - convertXmlToPdfNoValidation(token, xml, standard)');
    });
  });

  describe('Token Information', () => {
    test('should display token information if tokens exist', async () => {
      const tokens = await loadTokens();

      if (!tokens) {
        console.log('\n⚠️ No tokens found. Complete OAuth flow first.');
        return;
      }

      console.log(
        '\n📊 Token Information:\n' +
          `🔑 Access token: ${tokens.access_token.substring(0, 30)}...\n` +
          `🔄 Refresh token: ${tokens.refresh_token.substring(0, 30)}...\n` +
          `📊 Token type: ${tokens.token_type}\n` +
          `⏰ Expires in: ${tokens.expires_in} seconds`
      );

      if (tokens.obtained_at && tokens.expires_at) {
        const now = Date.now();
        const isExpired = now > tokens.expires_at;
        console.log(
          `🕐 Obtained at: ${new Date(tokens.obtained_at).toISOString()}\n` +
            `⏰ Expires at: ${new Date(tokens.expires_at).toISOString()}\n` +
            `📊 Status: ${isExpired ? '❌ EXPIRED' : '✅ VALID'}`
        );

        if (!isExpired) {
          const timeLeft = Math.max(0, tokens.expires_at - now);
          console.log(`⏳ Time left: ${Math.round(timeLeft / 1000 / 60)} minutes`);
        }
      }

      // Try to decode JWT payload
      const { error: jwtError } = tryCatch(async () => {
        const payload = decodeJWT(tokens.access_token);
        console.log('\n📜 JWT Payload:');
        console.log(JSON.stringify(payload, null, 2));
      });
      if (jwtError) {
        console.log('\n⚠️ Could not decode JWT payload');
      }

      expect(tokens.access_token).toBeTruthy();
      expect(tokens.refresh_token).toBeTruthy();
    });
  });

  // Helper functions
  function openBrowser(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const platform = process.platform;
      let command: string;
      let args: string[];

      switch (platform) {
        case 'darwin': // macOS
          command = 'open';
          args = [url];
          break;
        case 'win32': // Windows
          command = 'start';
          args = ['', url];
          break;
        default: // Linux and others
          command = 'xdg-open';
          args = [url];
          break;
      }

      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
      });

      child.unref(); // Allow parent to exit

      // Resolve immediately since we don't need to wait for browser to close
      resolve();
    });
  }

  async function saveTokens(tokens: TokenResponse): Promise<void> {
    const tokenData = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_in: tokens.expires_in,
      token_type: tokens.token_type,
      scope: tokens.scope,
      obtained_at: Date.now(),
      expires_at: Date.now() + tokens.expires_in * 1000,
    };

    await fs.promises.writeFile(tokenFilePath, JSON.stringify(tokenData, null, 2));
  }

  async function loadTokens(): Promise<(TokenResponse & { obtained_at?: number; expires_at?: number }) | null> {
    const { data, error } = tryCatch(async () => {
      const tokenData = await fs.promises.readFile(tokenFilePath, 'utf-8');
      return JSON.parse(tokenData);
    });
    if (error) {
      return null;
    }
    return data;
  }

  function isTokenExpired(tokens: TokenResponse & { expires_at?: number }): boolean {
    if (!tokens.expires_at) return false;
    return Date.now() > tokens.expires_at;
  }

  function decodeJWT(token: string): any {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid JWT format');
    }

    const payload = parts[1];
    const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
    return JSON.parse(decoded);
  }
});
