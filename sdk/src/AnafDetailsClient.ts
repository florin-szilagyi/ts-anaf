/**
 * ANAF Details Client
 *
 * Client for fetching Romanian company data from the public ANAF API.
 * This service provides company information including VAT registration status,
 * addresses, and contact details based on CUI/CIF numbers.
 *
 * @example
 * ```typescript
 * import { AnafDetailsClient } from 'anaf-ts-sdk';
 *
 * const detailsClient = new AnafDetailsClient();
 *
 * // Fetch company data by VAT code
 * const result = await detailsClient.getCompanyData('RO12345678');
 * if (result.success) {
 *   console.log('Company:', result.data[0].name);
 *   console.log('VAT registered:', result.data[0].scpTva);
 * }
 *
 * // Validate VAT code format
 * const isValid = await detailsClient.isValidVatCode('RO12345678');
 * ```
 */

import { HttpClient } from './utils/httpClient';
import { tryCatch } from './tryCatch';
import { AnafNotFoundError, AnafSdkError } from './errors';
import {
  AnafDetailsConfig,
  AnafCompanyData,
  AnafCompanyResult,
  AnafCompanyLookupOptions,
  AnafRequestPayload,
  AnafApiResponse,
  AnafAsyncSubmitResponse,
  AnafAsyncResultResponse,
  AnafAsyncCompanyResult,
  AnafAsyncPollingConfig,
  AnafCompanyFullDetails,
  EFacturaRegistryResponse,
} from './types';

/**
 * Default configuration for ANAF Details client
 */
const DEFAULT_CONFIG: Required<AnafDetailsConfig> = {
  timeout: 30000,
  url: 'https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva',
  efacturaRegistryUrl: 'https://webservicesp.anaf.ro/api/registruroefactura/v1/interogare',
  asyncUrl: 'https://webservicesp.anaf.ro/AsynchWebService/api/v8/ws/tva',
  asyncResultUrl: 'https://webservicesp.anaf.ro/AsynchWebService/api/v7/ws/tva',
};

/**
 * ANAF Details Client for fetching Romanian company data
 */
export class AnafDetailsClient {
  private readonly httpClient: HttpClient;
  private readonly config: Required<AnafDetailsConfig>;

  /**
   * Create a new ANAF Details client
   *
   * @param config - Configuration options
   */
  constructor(config: AnafDetailsConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.httpClient = new HttpClient({
      timeout: this.config.timeout,
    });
  }

  /**
   * Get current date string in YYYY-MM-DD format
   *
   * @returns Current date string
   */
  private getCurrentDateString(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * Extract CUI number from VAT code
   *
   * @param vatCode - VAT code (with or without RO prefix)
   * @returns Numeric CUI or null if invalid
   */
  private extractCuiNumber(vatCode: string): number | null {
    if (!vatCode || typeof vatCode !== 'string') {
      return null;
    }

    // A CUI has 2 to 10 digits (the last one is a check digit), which also keeps it a safe integer
    const match = /^(?:RO\s*)?(\d{2,10})$/i.exec(vatCode.trim());
    const cuiNumber = match ? Number(match[1]) : 0;

    return cuiNumber > 0 ? cuiNumber : null;
  }

  /**
   * Transform ANAF API response to our format
   *
   * @param response - Raw ANAF API response
   * @param cui - Original CUI number
   * @returns Transformed company result
   */
  private transformResponse(
    response: AnafApiResponse,
    registryResponse?: EFacturaRegistryResponse | null
  ): AnafCompanyResult {
    const data: AnafCompanyData[] = [];
    if (response.found) {
      // Build a lookup map from the registry response by CUI
      const registryMap = new Map<number, EFacturaRegistryResponse['found'][number]>();
      if (registryResponse?.found) {
        for (const entry of registryResponse.found) {
          registryMap.set(entry.cui, entry);
        }
      }

      response.found.forEach((element) => {
        const cui = element.date_generale.cui;
        const registryEntry = registryMap.get(cui);

        const companyData: AnafCompanyData = {
          vatCode: cui.toString(),
          name: element.date_generale.denumire,
          registrationNumber: element.date_generale.nrRegCom,
          address: element.date_generale.adresa,
          postalCode: element.date_generale.codPostal,
          contactPhone: element.date_generale.telefon,
          scpTva: element.inregistrare_scop_Tva.scpTVA || false,
          caenCode: element.date_generale.cod_CAEN,
        };
        const inactive = element.stare_inactiv?.statusInactivi;
        if (typeof inactive === 'boolean') companyData.inactive = inactive;

        if (registryEntry) {
          companyData.efacturaRegistry = {
            registered: true,
            registru: registryEntry.registru,
            categorie: registryEntry.categorie,
            dataInscriere: registryEntry.dataInscriere,
            dataRenuntare: registryEntry.dataRenuntare,
            dataRadiere: registryEntry.dataRadiere,
            dataOptiuneB2G: registryEntry.dataOptiuneB2G,
            stare: registryEntry.stare,
          };
        } else if (registryResponse) {
          // Registry was queried but this CUI was not found in it
          companyData.efacturaRegistry = { registered: false };
        }
        // If registryResponse is null/undefined, we skip the field entirely
        // (registry call failed or was not made)

        data.push(companyData);
      });

      return {
        success: true,
        data,
        notFound: response.notFound ?? [],
      };
    }

    if (response.notFound) {
      return {
        success: false,
        error: 'Company not found for the provided VAT code.',
        notFound: response.notFound,
      };
    } else {
      return {
        success: false,
        error: 'Unexpected response structure from ANAF API: ' + JSON.stringify(response),
      };
    }
  }

  /**
   * Get company data for a single VAT code
   *
   * @param vatCode - The VAT code (CUI/CIF) to search for
   * @returns Promise with company data or error
   *
   * @example
   * ```typescript
   * const result = await client.getCompanyData('RO12345678');
   * if (result.success) {
   *   console.log('Company name:', result.data[0].name);
   *   console.log('Address:', result.data[0].address);
   *   console.log('VAT registered:', result.data[0].scpTva);
   * } else {
   *   console.error('Error:', result.error);
   * }
   * ```
   */
  async getCompanyData(vatCode: string): Promise<AnafCompanyResult> {
    return this.batchGetCompanyData([vatCode]);
  }

  /**
   * Batch fetch company data for multiple VAT codes
   *
   * @param vatCodes - Array of VAT codes to fetch (max 100)
   * @param options - Request date, and whether to also query the e-Factura registry
   * @returns Promise with company data or error
   *
   * @example
   * ```typescript
   * const result = await client.batchGetCompanyData(['RO12345678', 'RO87654321']);
   * if (result.success) {
   *   result.data.forEach((company, index) => {
   *     console.log(`Company ${index + 1}:`, company.name);
   *   });
   * } else {
   *   console.error('Error:', result.error);
   * }
   * ```
   */
  async batchGetCompanyData(vatCodes: string[], options: AnafCompanyLookupOptions = {}): Promise<AnafCompanyResult> {
    // Basic validation
    if (!vatCodes || vatCodes.length === 0) {
      return { success: false, error: 'No VAT codes provided.' };
    }

    if (vatCodes.length > 100) {
      return { success: false, error: 'Maximum 100 CUI codes per request.' };
    }

    if (options.date !== undefined && !this.isCalendarDate(options.date)) {
      return { success: false, error: `Invalid request date "${options.date}", expected YYYY-MM-DD.` };
    }

    const requestDate = options.date ?? this.getCurrentDateString();
    const validatedPayload: AnafRequestPayload[] = [];
    const invalidCodes: string[] = [];

    // Validate each VAT code and build payload
    for (const vatCode of vatCodes) {
      const cuiNumber = this.extractCuiNumber(vatCode);
      if (!cuiNumber) {
        invalidCodes.push(vatCode);
        continue;
      }

      validatedPayload.push({
        cui: cuiNumber,
        data: requestDate,
      });
    }

    if (validatedPayload.length === 0) {
      return {
        success: false,
        error: `All ${invalidCodes.length} provided VAT code(s) are invalid.`,
      };
    }

    const headers = { 'Content-Type': 'application/json' };

    // Fire both API calls in parallel — registry failure should not block company data
    const [companyResult, registryResult] = await Promise.allSettled([
      this.httpClient.post<AnafApiResponse>(this.config.url, validatedPayload, { headers }),
      options.includeEfacturaRegistry === false
        ? Promise.resolve(null)
        : this.httpClient.post<EFacturaRegistryResponse>(this.config.efacturaRegistryUrl, validatedPayload, {
            headers,
          }),
    ]);

    // Handle company data response (primary)
    if (companyResult.status === 'rejected') {
      const error = companyResult.reason;
      const statusCode = error instanceof AnafSdkError ? error.statusCode : undefined;
      const failure = {
        success: false,
        statusCode,
        retryAfter: error instanceof AnafSdkError ? error.retryAfter : undefined,
        // No status means a timeout or a network error
        retryable: statusCode === undefined || statusCode === 429 || statusCode >= 500,
      };

      if (error instanceof AnafNotFoundError) {
        // ANAF answers 404 when none of the CUIs exist, with the usual body listing them
        return {
          ...failure,
          error: 'Companies not found for the provided VAT codes.',
          notFound: this.parseNotFound(error.responseBody),
        };
      }

      if (error.message?.includes('fetch') || error.message?.toLowerCase().includes('network')) {
        return {
          ...failure,
          error: 'Network error: Could not connect to ANAF service.',
        };
      }

      return {
        ...failure,
        error: 'An unexpected error occurred while contacting the ANAF service.',
      };
    }

    if (!companyResult.value) {
      return {
        success: false,
        error: 'No response received from ANAF API.',
      };
    }

    // Extract registry data if available (graceful degradation)
    const registryData = registryResult.status === 'fulfilled' ? (registryResult.value?.data ?? null) : null;

    return this.transformResponse(companyResult.value.data, registryData);
  }

  private isCalendarDate(date: string): boolean {
    const time = Date.parse(`${date}T00:00:00Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(time) && new Date(time).toISOString().startsWith(date);
  }

  private parseNotFound(body: string | undefined): number[] | undefined {
    const { data } = tryCatch(() => JSON.parse(body ?? '') as { notFound?: unknown });
    const notFound = data?.notFound;
    return Array.isArray(notFound) && notFound.every((cui) => typeof cui === 'number') ? notFound : undefined;
  }

  /**
   * Validate if a VAT code is in the correct format for ANAF lookup
   *
   * @param vatCode - The VAT code to validate
   * @returns Promise resolving to boolean indicating if the format is valid
   *
   * @example
   * ```typescript
   * const isValid = await client.isValidVatCode('RO12345678');
   * console.log('Valid format:', isValid);
   * ```
   */
  async isValidVatCode(vatCode: string): Promise<boolean> {
    return this.extractCuiNumber(vatCode) !== null;
  }

  // ─── Async API methods ──────────────────────────────────────────────────────

  /**
   * Get company data for a single VAT code using the async ANAF API.
   * Returns richer data than the sync API, including full address details,
   * inactive status, split TVA, and e-Factura registry status.
   *
   * @param vatCode - The VAT code (CUI/CIF) to search for
   * @param pollingConfig - Optional polling configuration
   * @returns Promise with full company data or error
   *
   * @example
   * ```typescript
   * const result = await client.getCompanyDataAsync('RO12345678');
   * if (result.success) {
   *   console.log('Company:', result.data[0].name);
   *   console.log('e-Factura:', result.fullDetails[0].date_generale.statusRO_e_Factura);
   *   console.log('Inactive:', result.fullDetails[0].stare_inactiv.statusInactivi);
   * }
   * ```
   */
  async getCompanyDataAsync(vatCode: string, pollingConfig?: AnafAsyncPollingConfig): Promise<AnafAsyncCompanyResult> {
    return this.batchGetCompanyDataAsync([vatCode], pollingConfig);
  }

  /**
   * Batch fetch company data for multiple VAT codes using the async ANAF API.
   * Submits a POST request, then polls for the result.
   *
   * Rules enforced by ANAF:
   * - Max 100 CUIs per request
   * - Min 2 seconds before first poll
   * - Response can only be downloaded once
   * - Response expires after 3 days
   *
   * @param vatCodes - Array of VAT codes to fetch (max 100)
   * @param pollingConfig - Optional polling configuration
   * @returns Promise with full company data or error
   */
  async batchGetCompanyDataAsync(
    vatCodes: string[],
    pollingConfig?: AnafAsyncPollingConfig
  ): Promise<AnafAsyncCompanyResult> {
    if (!vatCodes || vatCodes.length === 0) {
      return { success: false, error: 'No VAT codes provided.' };
    }

    if (vatCodes.length > 100) {
      return { success: false, error: 'Maximum 100 CUI codes per request.' };
    }

    const requestDate = this.getCurrentDateString();
    const validatedPayload: AnafRequestPayload[] = [];
    const invalidCodes: string[] = [];

    for (const vatCode of vatCodes) {
      const cuiNumber = this.extractCuiNumber(vatCode);
      if (!cuiNumber) {
        invalidCodes.push(vatCode);
        continue;
      }

      validatedPayload.push({ cui: cuiNumber, data: requestDate });
    }

    if (validatedPayload.length === 0) {
      return {
        success: false,
        error: `All ${invalidCodes.length} provided VAT code(s) are invalid.`,
      };
    }

    // Step 1: Submit the request
    const { data: submitResponse, error: submitError } = await tryCatch(
      this.httpClient.post<AnafAsyncSubmitResponse>(this.config.asyncUrl, validatedPayload, {
        headers: { 'Content-Type': 'application/json' },
      })
    );

    if (submitError) {
      return {
        success: false,
        error: `Failed to submit async request: ${submitError.message}`,
      };
    }

    if (!submitResponse?.data?.correlationId) {
      return {
        success: false,
        error: 'No correlationId received from ANAF async API.',
      };
    }

    const { correlationId } = submitResponse.data;

    // Step 2: Poll for the result
    const initialDelay = Math.max(pollingConfig?.initialDelay ?? 2000, 2000);
    const retryDelay = pollingConfig?.retryDelay ?? 3000;
    const maxRetries = pollingConfig?.maxRetries ?? 10;

    await this.delay(initialDelay);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const resultUrl = `${this.config.asyncResultUrl}?id=${correlationId}`;

      const { data: pollResponse, error: pollError } = await tryCatch(
        this.httpClient.get<AnafAsyncResultResponse>(resultUrl)
      );

      if (pollError) {
        // If it's a retriable error (e.g., result not ready), wait and retry
        if (attempt < maxRetries - 1) {
          await this.delay(retryDelay);
          continue;
        }
        return {
          success: false,
          error: `Failed to fetch async result after ${maxRetries} attempts: ${pollError.message}`,
        };
      }

      if (pollResponse?.data?.cod === 200) {
        return this.transformAsyncResponse(pollResponse.data);
      }

      // Result not ready yet — wait and retry
      if (attempt < maxRetries - 1) {
        await this.delay(retryDelay);
      }
    }

    return {
      success: false,
      error: `Async result not available after ${maxRetries} poll attempts for correlationId: ${correlationId}`,
    };
  }

  /**
   * Transform the async API response into our result format
   */
  private transformAsyncResponse(response: AnafAsyncResultResponse): AnafAsyncCompanyResult {
    const data: AnafCompanyData[] = response.found.map((entry) => ({
      vatCode: entry.date_generale.cui.toString(),
      name: entry.date_generale.denumire,
      registrationNumber: entry.date_generale.nrRegCom,
      address: entry.date_generale.adresa,
      postalCode: entry.date_generale.codPostal,
      contactPhone: entry.date_generale.telefon,
      scpTva: entry.inregistrare_scop_Tva.scpTVA || false,
    }));

    return {
      success: true,
      data,
      fullDetails: response.found,
      notFound: response.notFound?.map((e) => e.cui) ?? [],
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
