import { create } from 'xmlbuilder2';
import { UploadResponse, StatusResponse, ExecutionStatus, UploadStatusValue } from '../types';
import { AnafXmlParsingError } from '../errors';
import { tryCatch } from '../tryCatch';

/**
 * Parses XML responses from ANAF API
 *
 * ANAF returns XML responses for upload, status check, and some other operations.
 * This utility provides a consistent way to parse these responses and extract
 * the relevant information.
 */

/**
 * Parse XML response from ANAF upload operations
 *
 * Upload success response format:
 * <header ExecutionStatus="0" index_incarcare="3828" dateResponse="202108051140"/>
 *
 * Upload error response format:
 * <header ExecutionStatus="1" dateResponse="202108051144">
 *   <Errors errorMessage="Error message here"/>
 * </header>
 *
 * @param xmlString Raw XML response from ANAF upload operations
 * @returns Parsed upload response object
 * @throws {AnafXmlParsingError} If XML cannot be parsed or has unexpected structure
 */
export function parseUploadResponse(xmlString: string): UploadResponse {
  const { data: doc, error } = tryCatch(() => {
    const grouped = create(xmlString).toObject({ group: true }) as any;
    const simple = create(xmlString).toObject() as any;
    return { grouped, simple };
  });

  if (error) {
    throw new AnafXmlParsingError('Failed to parse XML response', truncateForError(xmlString));
  }

  // Try to parse using grouped structure first
  let result = tryParseUploadStructure(doc.grouped);
  if (result) return result;

  // Fallback to simple structure
  result = tryParseUploadStructure(doc.simple);
  if (result) return result;

  throw new AnafXmlParsingError('Unknown or unexpected XML response structure', truncateForError(xmlString));
}

/**
 * Truncate a response string for inclusion in error objects to avoid memory bloat
 */
function truncateForError(str: string, maxLength: number = 500): string {
  if (!str || str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '... [truncated]';
}

/**
 * Try to parse upload XML structure
 */
function tryParseUploadStructure(doc: any): UploadResponse | null {
  if (!doc) return null;

  const header = doc.header || doc.Header;
  if (!header) return null;

  const content = Array.isArray(header) ? header[0] : header;
  const attributes = content['@'] || content;

  // Handle upload responses (have ExecutionStatus attribute)
  if (attributes.ExecutionStatus !== undefined) {
    const statusValue = Number(attributes.ExecutionStatus);
    const result: UploadResponse = {
      executionStatus: statusValue as ExecutionStatus,
      indexIncarcare: attributes.index_incarcare ? String(attributes.index_incarcare) : undefined,
      dateResponse: attributes.dateResponse ? String(attributes.dateResponse) : undefined,
    };

    if (statusValue === ExecutionStatus.Error) {
      const errorElements = content.Errors ? (Array.isArray(content.Errors) ? content.Errors : [content.Errors]) : [];
      result.errors = errorElements.map((err: any) => findErrorMessage(err) || '');
    }

    return result;
  }

  return null;
}

/**
 * Parse XML response from ANAF status check operations
 *
 * Status success response format:
 * <header stare="ok" id_descarcare="1234"/>
 * <header stare="in prelucrare"/>
 *
 * Status error response format:
 * <header><Errors errorMessage="Error message"/></header>
 *
 * @param xmlString Raw XML response from ANAF status operations
 * @returns Parsed status response object
 * @throws {AnafXmlParsingError} If XML cannot be parsed or has unexpected structure
 */
export function parseStatusResponse(xmlString: string): StatusResponse {
  const { data: doc, error } = tryCatch(() => {
    const grouped = create(xmlString).toObject({ group: true }) as any;
    const simple = create(xmlString).toObject() as any;
    return { grouped, simple };
  });

  if (error) {
    throw new AnafXmlParsingError('Failed to parse XML response', truncateForError(xmlString));
  }

  // Try to parse using grouped structure first
  let result = tryParseStatusStructure(doc.grouped);
  if (result) return result;

  // Fallback to simple structure
  result = tryParseStatusStructure(doc.simple);
  if (result) return result;

  throw new AnafXmlParsingError('Unknown or unexpected XML response structure', truncateForError(xmlString));
}

/**
 * Try to parse status XML structure
 */
function tryParseStatusStructure(doc: any): StatusResponse | null {
  if (!doc) return null;

  // Find the main response element - ANAF uses 'header' element
  const header = doc.header || doc.Header;

  if (!header) {
    return null;
  }

  const content = Array.isArray(header) ? header[0] : header;

  // xmlbuilder2 stores attributes in '@' property when using { group: true }
  const attributes = content['@'] || content;

  // Handle status responses (have stare attribute or id_descarcare)
  if (attributes.stare || attributes.id_descarcare) {
    const result: StatusResponse = {};

    if (attributes.stare) {
      result.stare = String(attributes.stare) as UploadStatusValue;
    }

    if (attributes.id_descarcare) {
      result.idDescarcare = String(attributes.id_descarcare);
    }

    return result;
  }

  // Handle error responses without ExecutionStatus (status endpoint errors)
  const errors = content.Errors || content.errors || content.Error || content.error;
  if (errors) {
    const errorElements = Array.isArray(errors) ? errors : [errors];
    const errorMessages = errorElements.map((err: any) => findErrorMessage(err) || 'Operation failed');
    return { errors: errorMessages };
  }

  // Fallback: Try to find other common response structures
  const raspuns = doc.Raspuns || doc.Envelope?.Body?.Raspuns || doc.response || doc.Response;

  if (raspuns) {
    const content = Array.isArray(raspuns) ? raspuns[0] : raspuns;

    // Handle status response (contains id_descarcare and/or stare)
    if (content.id_descarcare || content.stare) {
      return {
        idDescarcare: content.id_descarcare ? extractTextValue(content.id_descarcare) : undefined,
        stare: content.stare ? (extractTextValue(content.stare) as UploadStatusValue) : undefined,
      };
    }

    // Handle error responses
    if (content.Error || content.eroare) {
      const errorDetail = content.Error || content.eroare;
      const errorMessage = errorDetail.mesaj ? extractTextValue(errorDetail.mesaj) : extractTextValue(errorDetail);
      return { errors: [errorMessage] };
    }
  }

  return null;
}

/**
 * Extract text value from XML element
 * Handles both string values and array structures that xmlbuilder2 might create
 */
function extractTextValue(element: any): string {
  if (typeof element === 'string') {
    return element;
  }
  if (Array.isArray(element) && element.length > 0) {
    return String(element[0]);
  }
  if (typeof element === 'object' && element !== null && element._) {
    return String(element._);
  }
  return String(element);
}

/**
 * Recursively search for errorMessage in an object structure.
 * Has a depth limit to prevent stack overflow on deeply nested or circular structures.
 * @param obj Object to search in
 * @param depth Current recursion depth (internal)
 * @returns Found error message or null
 */
function findErrorMessage(obj: any, depth: number = 0): string | null {
  if (!obj || typeof obj !== 'object' || depth > 10) {
    return null;
  }

  // Direct check for errorMessage attribute/property
  if (obj.errorMessage) {
    return String(obj.errorMessage);
  }

  // Check in attributes object
  if (obj['@'] && obj['@'].errorMessage) {
    return String(obj['@'].errorMessage);
  }

  // Search through all properties
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'errorMessage' || key.endsWith('errorMessage')) {
      return String(value);
    }

    // Recursively search in nested objects
    if (typeof value === 'object' && value !== null) {
      const found = findErrorMessage(value, depth + 1);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

/**
 * Parse JSON response from ANAF API
 * Some endpoints return JSON instead of XML
 * @param response Response data that might be JSON
 * @returns Parsed object or throws error
 */
export function parseJsonResponse<T = any>(response: any): T {
  if (typeof response === 'string') {
    const { data, error } = tryCatch(() => {
      return JSON.parse(response);
    });

    if (error) {
      throw new AnafXmlParsingError('Failed to parse JSON response', truncateForError(response));
    }

    return data;
  }

  return response;
}

/**
 * Determine if a response is an error based on common ANAF patterns
 * @param response Parsed response object
 * @returns True if response indicates an error
 */
export function isErrorResponse(response: any): boolean {
  return !!(
    response?.errors ||
    response?.Error ||
    response?.error ||
    response?.eroare ||
    response?.executionStatus === ExecutionStatus.Error ||
    (response?.stare && response.stare.toLowerCase() === 'nok')
  );
}

/**
 * Extract error message from response
 * @param response Parsed response object
 * @returns Error message or null if no error found
 */
export function extractErrorMessage(response: any): string | null {
  if (response?.errors && Array.isArray(response.errors) && response.errors.length > 0) {
    return response.errors.join('; ');
  }
  if (response?.Error?.mesaj) return response.Error.mesaj;
  if (response?.error) return response.error;
  if (response?.eroare) return response.eroare; // Romanian error field used in list API responses
  if (response?.mesaj && response?.stare === 'nok') return response.mesaj;
  return null;
}

/**
 * Legacy function for backward compatibility - delegates to appropriate parser
 * @deprecated Use parseUploadResponse or parseStatusResponse instead
 */
export function parseXmlResponse(xmlString: string): UploadResponse | StatusResponse {
  // Try to determine response type by looking for ExecutionStatus attribute
  if (xmlString.includes('ExecutionStatus=')) {
    return parseUploadResponse(xmlString);
  } else {
    return parseStatusResponse(xmlString);
  }
}
