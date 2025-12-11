import { AnafApiError, AnafAuthenticationError, AnafNotFoundError, AnafValidationError } from '../errors';
import { tryCatch } from '../tryCatch';

interface HttpOptions extends RequestInit {
  timeout?: number;
  baseURL?: string;
  data?: any;
}

export interface HttpResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Headers;
}

/**
 * Simple HTTP client wrapper around native fetch
 * Provides timeout handling, status checking, and response type parsing
 */
export class HttpClient {
  private baseURL: string;
  private defaultTimeout: number;

  constructor(config: { baseURL?: string; timeout?: number } = {}) {
    this.baseURL = config.baseURL || '';
    this.defaultTimeout = config.timeout || 30000;
  }

  /**
   * Make HTTP request with timeout and error handling
   */
  async request<T = any>(url: string, options: HttpOptions = {}): Promise<HttpResponse<T>> {
    const { timeout = this.defaultTimeout, baseURL, ...fetchOptions } = options;

    // Build full URL
    const fullUrl = baseURL || this.baseURL ? new URL(url, baseURL || this.baseURL).toString() : url;

    // Setup timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const { data, error } = await tryCatch(
      (async () => {
        if (process.env.NODE_ENV === 'development') {
          console.log(`[HTTP] ${fetchOptions.method || 'GET'} ${fullUrl}`);
        }

        const response = await fetch(fullUrl, {
          ...fetchOptions,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (process.env.NODE_ENV === 'development') {
          console.log(`[HTTP] Response ${response.status} for ${fullUrl}`);
        }

        // Handle HTTP errors
        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          this.handleHttpError(response.status, response.statusText, errorText);
        }

        // Parse response based on content type
        const data = await this.parseResponse<T>(response);

        return {
          data,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        };
      })()
    );

    if (error) {
      clearTimeout(timeoutId);

      if (error?.name === 'AbortError') {
        throw new AnafApiError('Request timeout');
      }

      // Re-throw our custom errors
      if (
        error instanceof AnafApiError ||
        error instanceof AnafAuthenticationError ||
        error instanceof AnafValidationError ||
        error instanceof AnafNotFoundError
      ) {
        throw error;
      }

      throw new AnafApiError(`Network error: ${error?.message || 'Unknown error'}`);
    }

    return data;
  }

  /**
   * GET request
   */
  async get<T = any>(url: string, options: HttpOptions = {}): Promise<HttpResponse<T>> {
    return this.request<T>(url, { ...options, method: 'GET' });
  }

  /**
   * POST request
   */
  async post<T = any>(url: string, body?: any, options: HttpOptions = {}): Promise<HttpResponse<T>> {
    const requestOptions: HttpOptions = { ...options, method: 'POST' };

    if (body !== undefined) {
      if (typeof body === 'string') {
        requestOptions.body = body;
      } else if (body instanceof FormData) {
        requestOptions.body = body;
        // Don't set Content-Type for FormData - browser will set it with boundary
      } else {
        requestOptions.body = JSON.stringify(body);
        requestOptions.headers = {
          'Content-Type': 'application/json',
          ...requestOptions.headers,
        };
      }
    }

    return this.request<T>(url, requestOptions);
  }

  /**
   * Parse response based on content type or explicit type
   */
  private async parseResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type') || '';

    // For ArrayBuffer responses (PDF files)
    if (contentType.includes('application/pdf') || contentType.includes('application/octet-stream')) {
      return response.arrayBuffer() as Promise<T>;
    }

    // For JSON responses
    if (contentType.includes('application/json')) {
      return response.json() as Promise<T>;
    }

    // Default to text
    return response.text() as Promise<T>;
  }

  /**
   * Handle HTTP error status codes
   */
  private handleHttpError(status: number, statusText: string, errorText: string): never {
    const message = `HTTP ${status}: ${statusText}${errorText ? ` - ${errorText}` : ''}`;

    if (status === 401 || status === 403) {
      throw new AnafAuthenticationError(message);
    } else if (status === 404) {
      throw new AnafNotFoundError(message);
    } else if (status >= 400 && status < 500) {
      throw new AnafValidationError(message);
    } else {
      throw new AnafApiError(message, status, errorText);
    }
  }
}
