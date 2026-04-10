import qs from 'qs';
import { tryCatch } from '../tryCatch';

/**
 * Form encoding utilities for ANAF e-Factura SDK
 *
 * Provides consistent form encoding for OAuth and other
 * form-based API requests.
 */

/**
 * Encode object as application/x-www-form-urlencoded string
 * @param data Object to encode
 * @returns Encoded form string
 */
export function encodeForm(data: Record<string, string | number | boolean>): string {
  return qs.stringify(data, { encode: true });
}

/**
 * Build query string from object
 * @param obj Object to convert to query string
 * @returns Query string (without leading ?)
 */
export function buildQueryString(obj: Record<string, unknown>): string {
  return qs.stringify(obj, {
    encode: true,
    arrayFormat: 'repeat',
    skipNulls: true,
  });
}

/**
 * Encode OAuth token request body.
 *
 * Per ANAF documentation, client credentials are sent via Basic Auth header
 * (handled by the caller), so client_id/client_secret are NOT included in
 * the form body. Only grant_type, code/refresh_token, redirect_uri, and
 * token_content_type go in the body.
 *
 * @param params OAuth parameters (body-only fields)
 * @returns Encoded form data
 */
export function encodeOAuthTokenRequest(params: {
  grant_type: string;
  redirect_uri: string;
  code?: string;
  refresh_token?: string;
  token_content_type?: string;
}): string {
  const data: Record<string, string> = {
    grant_type: params.grant_type,
    redirect_uri: params.redirect_uri,
  };

  if (params.code) {
    data.code = params.code;
  }

  if (params.refresh_token) {
    data.refresh_token = params.refresh_token;
  }

  if (params.token_content_type) {
    data.token_content_type = params.token_content_type;
  }

  return encodeForm(data);
}

/**
 * Build HTTP Basic Auth header value from client credentials.
 * Per ANAF OAuth docs: "Client Authentication de tipul: Send as Basic Auth header"
 *
 * @param clientId OAuth client ID
 * @param clientSecret OAuth client secret
 * @returns Basic Auth header value (e.g., "Basic dXNlcjpwYXNz")
 */
export function buildBasicAuthHeader(clientId: string, clientSecret: string): string {
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  return `Basic ${credentials}`;
}

/**
 * Build OAuth authorization URL
 * @param baseUrl Authorization endpoint base URL
 * @param params Authorization parameters
 * @returns Complete authorization URL
 */
export function buildOAuthAuthorizationUrl(
  baseUrl: string,
  params: {
    client_id: string;
    response_type: string;
    redirect_uri: string;
    scope?: string;
    token_content_type?: string;
  }
): string {
  const queryParams = new URLSearchParams();

  queryParams.append('client_id', params.client_id);
  queryParams.append('response_type', params.response_type);
  queryParams.append('redirect_uri', params.redirect_uri);

  if (params.scope) {
    queryParams.append('scope', params.scope);
  }

  if (params.token_content_type) {
    queryParams.append('token_content_type', params.token_content_type);
  }

  return `${baseUrl}?${queryParams.toString()}`;
}

/**
 * Extract OAuth code from redirect URL
 * @param redirectUrl Full redirect URL containing code parameter
 * @returns Authorization code or null if not found
 */
export function extractOAuthCode(redirectUrl: string): string | null {
  const { data: code } = tryCatch(() => {
    const url = new URL(redirectUrl);
    return url.searchParams.get('code');
  });

  return code;
}

/**
 * Extract OAuth error from redirect URL
 * @param redirectUrl Full redirect URL that might contain error
 * @returns Error information or null if no error
 */
export function extractOAuthError(redirectUrl: string): { error: string; error_description?: string } | null {
  const { data: error } = tryCatch(() => {
    const url = new URL(redirectUrl);
    return url.searchParams.get('error');
  });

  const { data: error_description } = tryCatch(() => {
    const url = new URL(redirectUrl);
    return url.searchParams.get('error_description');
  });

  return { error: error || '', error_description: error_description || undefined };
}
