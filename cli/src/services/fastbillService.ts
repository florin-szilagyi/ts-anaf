import {
  FastbillApiError,
  FastbillClient,
  FastbillTimeoutError,
  type CompanyResource,
  type CreateInvoiceInput,
  type CreateInvoiceResult,
  type InvoiceResource,
  type ListInvoicesFilters,
  type ListInvoicesResult,
  type ValidateResult,
} from '@florinszilagyi/fastbill-sdk';
import { CliError } from '../output/errors';
import { FastbillStore } from '../state/fastbillStore';
import type { XdgPaths } from '../state';

/**
 * fastbill API access for the CLI. Key resolution precedence:
 *   --api-key flag > FASTBILL_API_KEY env > stored fastbill.json.
 * Base URL: --base-url flag > FASTBILL_BASE_URL env > stored baseUrl > default.
 */

export interface FastbillClientLike {
  mode: 'test' | 'live';
  createInvoice(input: CreateInvoiceInput, opts?: { idempotencyKey?: string }): Promise<CreateInvoiceResult>;
  getInvoice(id: string): Promise<InvoiceResource>;
  waitForInvoice(
    id: string,
    opts?: { pollIntervalMs?: number; timeoutMs?: number; onPoll?: (invoice: InvoiceResource) => void }
  ): Promise<InvoiceResource>;
  listInvoices(filters?: ListInvoicesFilters): Promise<ListInvoicesResult>;
  listCompanies(): Promise<CompanyResource[]>;
  validateInvoice(input: CreateInvoiceInput): Promise<ValidateResult>;
  downloadXml(id: string): Promise<Buffer>;
  downloadZip(id: string): Promise<Buffer>;
  downloadPdf(id: string): Promise<Buffer>;
}

export interface FastbillServiceOptions {
  paths?: XdgPaths;
  store?: FastbillStore;
  clientFactory?: (config: { apiKey: string; baseUrl?: string }) => FastbillClientLike;
  env?: NodeJS.ProcessEnv;
}

export interface FastbillCallOptions {
  apiKey?: string;
  baseUrl?: string;
}

export class FastbillService {
  private readonly store: FastbillStore;
  private readonly clientFactory: (config: { apiKey: string; baseUrl?: string }) => FastbillClientLike;
  private readonly env: NodeJS.ProcessEnv;

  constructor(opts: FastbillServiceOptions = {}) {
    this.store = opts.store ?? new FastbillStore({ paths: opts.paths });
    this.clientFactory = opts.clientFactory ?? ((config) => new FastbillClient(config));
    this.env = opts.env ?? process.env;
  }

  setKey(apiKey: string, baseUrl?: string): { mode: 'test' | 'live' } {
    if (!/^sk_(test|live)_/.test(apiKey)) {
      throw new CliError({
        code: 'INVALID_FASTBILL_INPUT',
        message: 'API key must be a fastbill secret key (sk_test_… or sk_live_…)',
        category: 'user_input',
      });
    }
    this.store.write({ apiKey, ...(baseUrl ? { baseUrl } : {}) });
    return { mode: apiKey.startsWith('sk_live_') ? 'live' : 'test' };
  }

  clearKey(): void {
    this.store.remove();
  }

  hasStoredKey(): boolean {
    return this.store.exists();
  }

  client(opts: FastbillCallOptions = {}): FastbillClientLike {
    const stored = this.store.exists() ? this.store.read() : undefined;
    const apiKey = opts.apiKey ?? this.env.FASTBILL_API_KEY ?? stored?.apiKey;
    if (!apiKey) {
      throw new CliError({
        code: 'FASTBILL_KEY_MISSING',
        message: 'No fastbill API key. Pass --api-key, set FASTBILL_API_KEY, or run `anaf-cli fastbill auth set-key`.',
        category: 'auth',
      });
    }
    const baseUrl = opts.baseUrl ?? this.env.FASTBILL_BASE_URL ?? stored?.baseUrl;
    try {
      return this.clientFactory({ apiKey, ...(baseUrl ? { baseUrl } : {}) });
    } catch (cause) {
      throw new CliError({
        code: 'INVALID_FASTBILL_INPUT',
        message: (cause as Error).message,
        category: 'user_input',
      });
    }
  }

  /** Run a client call, translating SDK errors into CliErrors. */
  async call<T>(opts: FastbillCallOptions, fn: (client: FastbillClientLike) => Promise<T>): Promise<T> {
    const client = this.client(opts);
    try {
      return await fn(client);
    } catch (cause) {
      throw toCliError(cause);
    }
  }
}

function toCliError(cause: unknown): CliError {
  if (cause instanceof CliError) return cause;
  if (cause instanceof FastbillTimeoutError) {
    return new CliError({
      code: 'FASTBILL_TIMEOUT',
      message: cause.message,
      category: 'anaf_api',
      details: { invoiceId: cause.invoiceId, lastStatus: cause.lastStatus },
    });
  }
  if (cause instanceof FastbillApiError) {
    const details = {
      fastbillCode: cause.code,
      status: cause.status,
      ...(cause.details ? { info: cause.details } : {}),
    };
    if (cause.code === 'UNAUTHORIZED' || cause.code === 'FORBIDDEN') {
      return new CliError({ code: 'FASTBILL_AUTH_FAILED', message: cause.message, category: 'auth', details });
    }
    if (cause.status === 400 || cause.status === 404 || cause.status === 409 || cause.status === 422) {
      return new CliError({ code: 'INVALID_FASTBILL_INPUT', message: cause.message, category: 'user_input', details });
    }
    return new CliError({ code: 'FASTBILL_API_ERROR', message: cause.message, category: 'anaf_api', details });
  }
  return new CliError({
    code: 'FASTBILL_API_ERROR',
    message: cause instanceof Error ? cause.message : String(cause),
    category: 'anaf_api',
  });
}
