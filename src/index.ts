/**
 * ANAF e-Factura TypeScript SDK
 *
 * A comprehensive TypeScript SDK for interacting with the Romanian ANAF e-Factura system.
 * Provides OAuth 2.0 authentication, document upload/download, validation, UBL generation,
 * and company data lookup from the public ANAF API.
 *
 * @example
 * ```typescript
 * import { AnafAuthenticator, AnafEfacturaClient, AnafDetailsClient } from 'efactura-ts-sdk';
 *
 * // Setup authentication
 * const auth = new AnafAuthenticator({
 *   clientId: 'your-oauth-client-id',
 *   clientSecret: 'your-oauth-client-secret',
 *   redirectUri: 'https://your-app.com/callback'
 * });
 *
 * // Setup API client
 * const client = new AnafEfacturaClient({
 *   vatNumber: 'RO12345678',
 *   testMode: true
 * });
 *
 * // Setup company details client
 * const detailsClient = new AnafDetailsClient();
 *
 * // Authenticate and get tokens
 * const authUrl = auth.getAuthorizationUrl();
 * const tokens = await auth.exchangeCodeForToken(authCode);
 *
 * // Use tokens for API operations
 * const uploadResult = await client.uploadDocument(tokens.access_token, xmlContent);
 *
 * // Fetch company data
 * const companyData = await detailsClient.getCompanyData('RO12345678');
 * ```
 */

// Main exports
export { EfacturaClient } from './EfacturaClient';
export { EfacturaToolsClient } from './EfacturaToolsClient';
export { TokenManager } from './TokenManager';
export { AnafEfacturaClient } from './AnafClient';
export { AnafAuthenticator } from './AnafAuthenticator';
export { AnafDetailsClient } from './AnafDetailsClient';
export { UblBuilder } from './UblBuilder';

// Types
export * from './types';

// Errors
export * from './errors';

// UBL Builder
export * from './ubl';

// Utilities (for advanced users)
export * as Utils from './utils/xmlParser';
export * as DateUtils from './utils/dateUtils';
export * as FormUtils from './utils/formEncoder';

// Constants (for advanced users)
export * as Constants from './constants';

// Default export for convenience
export { AnafEfacturaClient as default } from './AnafClient';
