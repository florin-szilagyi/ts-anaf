import type { FastbillErrorCode } from './schemas';

/** Error envelope returned by the fastbill API, thrown as a typed exception. */
export class FastbillApiError extends Error {
  readonly code: FastbillErrorCode | string;
  readonly status: number;
  readonly details?: unknown;

  constructor(opts: { code: string; status: number; message: string; details?: unknown }) {
    super(opts.message);
    this.name = 'FastbillApiError';
    this.code = opts.code;
    this.status = opts.status;
    this.details = opts.details;
  }
}

export class FastbillRateLimitError extends FastbillApiError {
  readonly retryAfterSeconds: number;

  constructor(opts: { code: string; status: number; message: string; details?: unknown; retryAfterSeconds: number }) {
    super(opts);
    this.name = 'FastbillRateLimitError';
    this.retryAfterSeconds = opts.retryAfterSeconds;
  }
}

/** waitForInvoice gave up before the invoice reached a terminal status. */
export class FastbillTimeoutError extends Error {
  readonly invoiceId: string;
  readonly lastStatus: string;

  constructor(invoiceId: string, lastStatus: string, timeoutMs: number) {
    super(`Invoice ${invoiceId} still "${lastStatus}" after ${Math.round(timeoutMs / 1000)}s`);
    this.name = 'FastbillTimeoutError';
    this.invoiceId = invoiceId;
    this.lastStatus = lastStatus;
  }
}
