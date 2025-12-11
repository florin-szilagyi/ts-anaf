/**
 * ANAF Details Client
 *
 * Client for fetching Romanian company data from the public ANAF API.
 * This service provides company information including VAT registration status,
 * addresses, and contact details based on CUI/CIF numbers.
 *
 * @example
 * ```typescript
 * import { AnafDetailsClient } from 'efactura-ts-sdk';
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
import { AnafNotFoundError } from './errors';
import { AnafDetailsConfig, AnafCompanyData, AnafCompanyResult, AnafRequestPayload, AnafApiResponse } from './types';

/**
 * Default configuration for ANAF Details client
 */
const DEFAULT_CONFIG: Required<AnafDetailsConfig> = {
  timeout: 30000,
  url: 'https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva',
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

    // Remove RO prefix if present and extract numeric part
    const cuiString = vatCode.trim().toUpperCase().replace(/^RO/i, '');
    const cuiNumber = parseInt(cuiString, 10);

    if (isNaN(cuiNumber) || cuiNumber <= 0) {
      return null;
    }

    return cuiNumber;
  }

  /**
   * Transform ANAF API response to our format
   *
   * @param response - Raw ANAF API response
   * @param cui - Original CUI number
   * @returns Transformed company result
   */
  private transformResponse(response: AnafApiResponse, cui: number): AnafCompanyResult {
    const data: AnafCompanyData[] = [];
    if (response.found) {
      response.found.forEach((element) => {
        data.push({
          vatCode: element.date_generale.cui.toString(),
          name: element.date_generale.denumire,
          registrationNumber: element.date_generale.nrRegCom,
          address: element.date_generale.adresa,
          postalCode: element.date_generale.codPostal,
          contactPhone: element.date_generale.telefon,
          scpTva: element.inregistrare_scop_Tva.scpTVA || false,
        });
      });

      return {
        success: true,
        data,
      };
    }

    if (response.notFound) {
      return {
        success: false,
        error: 'Company not found for the provided VAT code.',
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
   * @param vatCodes - Array of VAT codes to fetch
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
  async batchGetCompanyData(vatCodes: string[]): Promise<AnafCompanyResult> {
    // Basic validation
    if (!vatCodes || vatCodes.length === 0) {
      return { success: false, error: 'No VAT codes provided.' };
    }

    const requestDate = this.getCurrentDateString();
    const validatedPayload: AnafRequestPayload[] = [];
    const invalidCodes: string[] = [];

    // Validate each VAT code and build payload
    for (const vatCode of vatCodes) {
      if (!vatCode || vatCode.trim().length < 2) {
        invalidCodes.push(vatCode);
        continue;
      }

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
        error: `All provided VAT codes are invalid: ${invalidCodes.join(', ')}`,
      };
    }

    console.log(`ANAF Details: Calling ANAF API for ${validatedPayload.length} CUIs, Date: ${requestDate}`);

    const { data, error } = await tryCatch(
      this.httpClient.post<AnafApiResponse>(this.config.url, validatedPayload, {
        headers: {
          'Content-Type': 'application/json',
        },
      })
    );

    if (error) {
      console.warn(`Error calling ANAF API for batch request:`, error);
      if (error instanceof AnafNotFoundError) {
        return {
          success: false,
          error: 'Companies not found for the provided VAT codes.',
        };
      }

      // Distinguish network errors from other errors
      if (error.message?.includes('fetch') || error.message?.toLowerCase().includes('network')) {
        return {
          success: false,
          error: 'Network error: Could not connect to ANAF service.',
        };
      }

      return {
        success: false,
        error: 'An unexpected error occurred while contacting the ANAF service.',
      };
    }

    if (!data) {
      return {
        success: false,
        error: 'No response received from ANAF API.',
      };
    }

    console.log('ANAF API successful response for batch request');

    const transformedResult = this.transformResponse(data.data, 0); // CUI not needed for batch

    return transformedResult;
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
    if (!vatCode) return false;

    // Remove RO prefix if present and check if remaining is numeric
    const cleanVatCode = vatCode.trim().toUpperCase().replace(/^RO/i, '');
    const cuiNumber = parseInt(cleanVatCode, 10);

    return !isNaN(cuiNumber) && cleanVatCode.length >= 2 && cleanVatCode.length <= 10 && cuiNumber > 0;
  }
}
