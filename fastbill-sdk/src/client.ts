import { randomUUID } from 'node:crypto';
import { FastbillApiError, FastbillRateLimitError, FastbillTimeoutError } from './errors';
import {
  TERMINAL_INVOICE_STATUSES,
  type ApiMode,
  type CompanyResource,
  type CreateInvoiceInput,
  type CreateInvoiceResult,
  type InvoiceResource,
  type ListInvoicesFilters,
  type ListInvoicesResult,
  type ValidateResult,
} from './schemas';

export interface FastbillClientConfig {
  /** sk_test_… or sk_live_… — create keys in the fastbill dashboard. */
  apiKey: string;
  /** API origin, default https://fastbill.app. Point at a local instance for dev. */
  baseUrl?: string;
  /** Per-attempt timeout in ms (default 30s). */
  timeoutMs?: number;
  /** Retries on 429/5xx/network failures (default 3, exponential backoff, honors Retry-After). */
  maxRetries?: number;
  /** Injectable fetch for tests. */
  fetch?: typeof fetch;
}

const DEFAULT_BASE_URL = 'https://fastbill.app';
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 10_000;
const RETRY_AFTER_CAP_MS = 60_000;

interface RequestOptions {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
}

export class FastbillClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: FastbillClientConfig) {
    if (!/^sk_(test|live)_/.test(config.apiKey ?? '')) {
      throw new Error('apiKey must be a fastbill secret key (sk_test_… or sk_live_…)');
    }
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 3;
    this.fetchImpl = config.fetch ?? fetch;
  }

  /** 'test' keys target ANAF's test environment; 'live' keys are fiscal. */
  get mode(): ApiMode {
    return this.apiKey.startsWith('sk_live_') ? 'live' : 'test';
  }

  /**
   * Create an invoice (async — the API returns 202 and processes via a queue).
   * An Idempotency-Key is generated automatically when not supplied, so
   * network retries can never double-invoice.
   */
  async createInvoice(input: CreateInvoiceInput, opts: { idempotencyKey?: string } = {}): Promise<CreateInvoiceResult> {
    const idempotencyKey = opts.idempotencyKey ?? randomUUID();
    const { data, status } = await this.request<{
      id: string;
      status: InvoiceResource['status'];
      links?: { self: string };
    }>({
      method: 'POST',
      path: '/api/v1/invoices',
      body: input,
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return { ...data, replayed: status === 200 };
  }

  async getInvoice(id: string): Promise<InvoiceResource> {
    const { data } = await this.request<InvoiceResource>({ method: 'GET', path: `/api/v1/invoices/${id}` });
    return data;
  }

  /**
   * Poll until the invoice reaches a terminal status
   * (validated | rejected | failed | received). ANAF validation can take
   * minutes — default poll interval 15s, default budget 30 minutes.
   */
  async waitForInvoice(
    id: string,
    opts: { pollIntervalMs?: number; timeoutMs?: number; onPoll?: (invoice: InvoiceResource) => void } = {}
  ): Promise<InvoiceResource> {
    const interval = opts.pollIntervalMs ?? 15_000;
    const budget = opts.timeoutMs ?? 30 * 60_000;
    const deadline = Date.now() + budget;
    let invoice = await this.getInvoice(id);
    for (;;) {
      opts.onPoll?.(invoice);
      if (TERMINAL_INVOICE_STATUSES.includes(invoice.status)) return invoice;
      if (Date.now() + interval > deadline) {
        throw new FastbillTimeoutError(id, invoice.status, budget);
      }
      await sleep(interval);
      invoice = await this.getInvoice(id);
    }
  }

  async listInvoices(filters: ListInvoicesFilters = {}): Promise<ListInvoicesResult> {
    const { data } = await this.request<ListInvoicesResult>({
      method: 'GET',
      path: '/api/v1/invoices',
      query: {
        direction: filters.direction,
        status: filters.status,
        from: filters.from,
        to: filters.to,
        counterparty_cif: filters.counterpartyCif,
        company_id: filters.companyId,
        limit: filters.limit,
        cursor: filters.cursor,
      },
    });
    return data;
  }

  /** Iterate all matching invoices, transparently following cursor pages. */
  async *iterateInvoices(filters: Omit<ListInvoicesFilters, 'cursor'> = {}): AsyncGenerator<InvoiceResource> {
    let cursor: string | undefined;
    do {
      const page = await this.listInvoices({ ...filters, cursor });
      for (const invoice of page.invoices) yield invoice;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  async listCompanies(): Promise<CompanyResource[]> {
    const { data } = await this.request<{ companies: CompanyResource[] }>({ method: 'GET', path: '/api/v1/companies' });
    return data.companies;
  }

  /** Build + validate the UBL for a payload without creating anything. Not quota-counted. */
  async validateInvoice(input: CreateInvoiceInput): Promise<ValidateResult> {
    const { data } = await this.request<ValidateResult>({ method: 'POST', path: '/api/v1/validate', body: input });
    return data;
  }

  async downloadXml(id: string): Promise<Buffer> {
    return this.download(`/api/v1/invoices/${id}/xml`);
  }

  async downloadZip(id: string): Promise<Buffer> {
    return this.download(`/api/v1/invoices/${id}/zip`);
  }

  async downloadPdf(id: string): Promise<Buffer> {
    return this.download(`/api/v1/invoices/${id}/pdf`);
  }

  // ---------- internals ----------

  private async request<T>(opts: RequestOptions): Promise<{ data: T; status: number }> {
    const res = await this.fetchWithRetry(opts);
    const body = (await res.json()) as {
      success: boolean;
      data?: T;
      error?: { code: string; message: string; details?: unknown };
    };
    if (!body.success || body.data === undefined) {
      throw this.toError(res, body.error);
    }
    return { data: body.data, status: res.status };
  }

  private async download(path: string): Promise<Buffer> {
    // The API 302s to a short-lived presigned URL; fetch follows it. Errors
    // (401, 404 "not stored yet") still come back as JSON envelopes.
    const res = await this.fetchWithRetry({ method: 'GET', path });
    if ((res.headers.get('content-type') ?? '').includes('application/json')) {
      const body = (await res.json()) as { error?: { code: string; message: string; details?: unknown } };
      throw this.toError(res, body.error);
    }
    return Buffer.from(await res.arrayBuffer());
  }

  private async fetchWithRetry(opts: RequestOptions): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(this.backoffMs(attempt, lastError));
      }
      let res: Response;
      try {
        res = await this.doFetch(opts);
      } catch (cause) {
        // network failure / timeout — retryable
        lastError = cause;
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        lastError = await this.responseToError(res);
        continue;
      }
      return res;
    }
    if (lastError instanceof FastbillApiError) throw lastError;
    throw new FastbillApiError({
      code: 'NETWORK_ERROR',
      status: 0,
      message: `Request failed after ${this.maxRetries + 1} attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    });
  }

  private async doFetch(opts: RequestOptions): Promise<Response> {
    const url = new URL(this.baseUrl + opts.path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url.toString(), {
        method: opts.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...opts.headers,
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        redirect: 'follow',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private backoffMs(attempt: number, lastError: unknown): number {
    if (lastError instanceof FastbillRateLimitError) {
      return Math.min(lastError.retryAfterSeconds * 1000, RETRY_AFTER_CAP_MS);
    }
    return Math.min(BACKOFF_BASE_MS * 2 ** (attempt - 1), BACKOFF_CAP_MS);
  }

  private async responseToError(res: Response): Promise<FastbillApiError> {
    let error: { code: string; message: string; details?: unknown } | undefined;
    try {
      error = ((await res.json()) as { error?: typeof error }).error;
    } catch {
      // non-JSON error body (proxy, gateway) — synthesize
    }
    return this.toError(res, error);
  }

  private toError(res: Response, error?: { code: string; message: string; details?: unknown }): FastbillApiError {
    const code =
      error?.code ?? (res.status === 429 ? 'RATE_LIMITED' : res.status >= 500 ? 'INTERNAL' : 'INVALID_REQUEST');
    const message = error?.message ?? `fastbill API error (HTTP ${res.status})`;
    if (res.status === 429) {
      const parsed = Number(res.headers.get('retry-after'));
      const retryAfter = Number.isFinite(parsed) && res.headers.get('retry-after') !== null ? Math.max(0, parsed) : 30;
      return new FastbillRateLimitError({
        code,
        status: res.status,
        message,
        details: error?.details,
        retryAfterSeconds: retryAfter,
      });
    }
    return new FastbillApiError({ code, status: res.status, message, details: error?.details });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
