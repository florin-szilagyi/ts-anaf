/**
 * fastbill API error contract — mirrors the CLI's CliError envelope:
 * failures render as {"success":false,"error":{"code","message","details?"}}.
 */

export type ApiErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_INVOICE_INPUT'
  | 'INVALID_REQUEST'
  | 'COMPANY_NOT_FOUND'
  | 'COMPANY_NOT_VERIFIED'
  | 'GRANT_MISSING'
  | 'GRANT_EXPIRED'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'ANAF_ERROR'
  | 'INTERNAL';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_INVOICE_INPUT: 422,
  INVALID_REQUEST: 400,
  COMPANY_NOT_FOUND: 404,
  COMPANY_NOT_VERIFIED: 409,
  GRANT_MISSING: 409,
  GRANT_EXPIRED: 409,
  QUOTA_EXCEEDED: 429,
  RATE_LIMITED: 429,
  IDEMPOTENCY_CONFLICT: 409,
  ANAF_ERROR: 502,
  INTERNAL: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(opts: { code: ApiErrorCode; message: string; details?: unknown; headers?: Record<string, string> }) {
    super(opts.message);
    this.name = 'ApiError';
    this.code = opts.code;
    this.status = STATUS_BY_CODE[opts.code];
    this.details = opts.details;
    this.headers = opts.headers;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
