/**
 * Registry of every error code the CLI emits, grouped by category.
 *
 * This module is the single source of truth for the error envelope contract:
 * every `CliError.code` value that ships must appear here. Tests and external
 * integrations can import `ERROR_CODES` to statically verify expected codes.
 *
 * The category → exit code mapping lives in {@link ./exitCodes.ts}. This file
 * only groups codes by category for discoverability.
 */

import type { ErrorCategory } from './types';

export const ERROR_CODES = {
  generic: ['GENERIC', 'NOT_IMPLEMENTED', 'COMMANDER_ERROR', 'UBL_BUILD_FAILED'],
  user_input: [
    'BAD_USAGE',
    'INVALID_CUI',
    'INVALID_DATE',
    'INVALID_LINE',
    'INVALID_INVOICE_INPUT',
    'INVALID_UPLOAD_INPUT',
    'INVALID_OUTPUT_TARGET',
    'INVALID_MANIFEST_FILE',
    'INVALID_MANIFEST_DOCUMENT',
    'UNKNOWN_MANIFEST_KIND',
    'UNSUPPORTED_API_VERSION',
  ],
  auth: ['AUTH_FAILED', 'CLIENT_SECRET_MISSING', 'NO_REFRESH_TOKEN'],
  anaf_api: [
    'LOOKUP_FAILED',
    'LOOKUP_NOT_FOUND',
    'UPLOAD_FAILED',
    'STATUS_FAILED',
    'DOWNLOAD_FAILED',
    'MESSAGES_FAILED',
    'VALIDATION_FAILED',
    'SIGNATURE_VALIDATION_FAILED',
    'PDF_CONVERSION_FAILED',
  ],
  local_state: [
    'CONTEXT_NOT_FOUND',
    'CONTEXT_EXISTS',
    'CONTEXT_NAME_INVALID',
    'NO_CURRENT_CONTEXT',
    'INVALID_CONTEXT_FILE',
    'INVALID_CONFIG_FILE',
    'INVALID_TOKEN_FILE',
    'INVALID_CACHE_FILE',
  ],
} as const satisfies Record<ErrorCategory, readonly string[]>;

export type KnownErrorCode = (typeof ERROR_CODES)[ErrorCategory][number];

export function isKnownErrorCode(code: string): code is KnownErrorCode {
  for (const list of Object.values(ERROR_CODES)) {
    if ((list as readonly string[]).includes(code)) return true;
  }
  return false;
}
