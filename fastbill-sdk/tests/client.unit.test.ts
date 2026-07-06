import { FastbillApiError, FastbillClient, FastbillRateLimitError, FastbillTimeoutError } from '../src';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function ok(data: unknown, status = 200): Response {
  return jsonResponse(status, { success: true, data });
}

function fail(status: number, code: string, message = 'nope', headers: Record<string, string> = {}): Response {
  return jsonResponse(status, { success: false, error: { code, message } }, headers);
}

/** Fetch stub that pops queued responses (a function entry may throw) and records calls. */
function makeFetch(queue: Array<Response | (() => Response)>): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])
    );
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = queue.shift();
    if (!next) throw new Error('fetch queue exhausted');
    return typeof next === 'function' ? next() : next;
  }) as typeof fetch;
  return { fetch: impl, calls };
}

function client(
  queue: Array<Response | (() => Response)>,
  opts: Partial<ConstructorParameters<typeof FastbillClient>[0]> = {}
) {
  const { fetch, calls } = makeFetch(queue);
  return {
    client: new FastbillClient({ apiKey: 'sk_test_abc', baseUrl: 'http://fb.local', maxRetries: 2, fetch, ...opts }),
    calls,
  };
}

const INPUT = {
  companyId: 'a0000000-0000-4000-8000-000000000001',
  invoiceNumber: 'FB-1',
  issueDate: '2026-07-01',
  customerCui: 'RO123456',
  lines: [{ description: 'x', quantity: 1, unitPrice: 10, taxPercent: 19 }],
};

describe('FastbillClient basics', () => {
  it('rejects non-secret keys and exposes the mode', () => {
    expect(() => new FastbillClient({ apiKey: 'pk_test_x' })).toThrow(/sk_test_/);
    expect(new FastbillClient({ apiKey: 'sk_live_x' }).mode).toBe('live');
    expect(new FastbillClient({ apiKey: 'sk_test_x' }).mode).toBe('test');
  });

  it('sends bearer auth and unwraps the success envelope', async () => {
    const { client: c, calls } = client([ok({ companies: [{ id: '1', cif: '123' }] })]);
    const companies = await c.listCompanies();
    expect(companies).toHaveLength(1);
    expect(calls[0].url).toBe('http://fb.local/api/v1/companies');
    expect(calls[0].headers.authorization).toBe('Bearer sk_test_abc');
  });

  it('throws typed errors for 4xx envelopes without retrying', async () => {
    const { client: c, calls } = client([fail(401, 'UNAUTHORIZED', 'bad key')]);
    await expect(c.listCompanies()).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401, message: 'bad key' });
    expect(calls).toHaveLength(1); // 4xx (non-429) never retries
  });
});

describe('createInvoice', () => {
  it('auto-generates a stable Idempotency-Key across retries', async () => {
    const { client: c, calls } = client([fail(500, 'INTERNAL'), ok({ id: 'inv-1', status: 'queued' }, 202)]);
    const result = await c.createInvoice(INPUT);
    expect(result).toMatchObject({ id: 'inv-1', status: 'queued', replayed: false });
    expect(calls).toHaveLength(2);
    const key1 = calls[0].headers['idempotency-key'];
    expect(key1).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[1].headers['idempotency-key']).toBe(key1);
  });

  it('honors a caller-provided idempotency key and flags replays (HTTP 200)', async () => {
    const { client: c, calls } = client([ok({ id: 'inv-1', status: 'queued' }, 200)]);
    const result = await c.createInvoice(INPUT, { idempotencyKey: 'my-key' });
    expect(result.replayed).toBe(true);
    expect(calls[0].headers['idempotency-key']).toBe('my-key');
    expect(calls[0].body).toMatchObject({ invoiceNumber: 'FB-1' });
  });
});

describe('retry behavior', () => {
  it('retries 429 honoring Retry-After, then succeeds', async () => {
    const { client: c, calls } = client([
      fail(429, 'RATE_LIMITED', 'slow down', { 'retry-after': '0' }),
      ok({ companies: [] }),
    ]);
    await expect(c.listCompanies()).resolves.toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it('surfaces FastbillRateLimitError when retries are exhausted', async () => {
    const { client: c } = client([fail(429, 'RATE_LIMITED', 'x', { 'retry-after': '0' })], { maxRetries: 0 });
    const err = await c.listCompanies().catch((e) => e);
    expect(err).toBeInstanceOf(FastbillRateLimitError);
    expect((err as FastbillRateLimitError).retryAfterSeconds).toBe(0);
  });

  it('wraps repeated network failures', async () => {
    const boom = () => {
      throw new Error('ECONNREFUSED');
    };
    const { client: c } = client([boom, boom, boom], { maxRetries: 2 });
    const err = await c.listCompanies().catch((e) => e);
    expect(err).toBeInstanceOf(FastbillApiError);
    expect((err as FastbillApiError).code).toBe('NETWORK_ERROR');
    expect((err as FastbillApiError).message).toContain('3 attempts');
  });
});

describe('waitForInvoice', () => {
  const inv = (status: string) => ok({ id: 'inv-1', status, links: { self: 'x' } });

  it('polls until terminal', async () => {
    const { client: c, calls } = client([inv('queued'), inv('processing'), inv('validated')]);
    const seen: string[] = [];
    const result = await c.waitForInvoice('inv-1', {
      pollIntervalMs: 1,
      onPoll: (i) => seen.push(i.status),
    });
    expect(result.status).toBe('validated');
    expect(seen).toEqual(['queued', 'processing', 'validated']);
    expect(calls).toHaveLength(3);
  });

  it('throws FastbillTimeoutError when the budget is exhausted', async () => {
    const { client: c } = client([inv('processing'), inv('processing')]);
    const err = await c.waitForInvoice('inv-1', { pollIntervalMs: 5, timeoutMs: 8 }).catch((e) => e);
    expect(err).toBeInstanceOf(FastbillTimeoutError);
    expect((err as FastbillTimeoutError).lastStatus).toBe('processing');
  });
});

describe('listing', () => {
  it('passes filters as query params', async () => {
    const { client: c, calls } = client([ok({ invoices: [], nextCursor: null })]);
    await c.listInvoices({ status: 'validated', counterpartyCif: '123', limit: 5 });
    const url = new URL(calls[0].url);
    expect(url.searchParams.get('status')).toBe('validated');
    expect(url.searchParams.get('counterparty_cif')).toBe('123');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(url.searchParams.has('cursor')).toBe(false);
  });

  it('iterateInvoices follows cursors', async () => {
    const { client: c, calls } = client([
      ok({ invoices: [{ id: 'a' }, { id: 'b' }], nextCursor: 'cur-2' }),
      ok({ invoices: [{ id: 'c' }], nextCursor: null }),
    ]);
    const ids: string[] = [];
    for await (const inv of c.iterateInvoices({ status: 'queued' })) ids.push(inv.id);
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(new URL(calls[1].url).searchParams.get('cursor')).toBe('cur-2');
  });
});

describe('downloads', () => {
  it('returns binary buffers', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
    const { client: c } = client([
      new Response(bytes, { status: 200, headers: { 'content-type': 'application/zip' } }),
    ]);
    const buf = await c.downloadZip('inv-1');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect([...buf]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('maps JSON error envelopes on download paths', async () => {
    const { client: c } = client([fail(404, 'NOT_FOUND', 'No signed ZIP stored for this invoice yet')]);
    await expect(c.downloadZip('inv-1')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('validateInvoice', () => {
  it('unwraps the validation verdict', async () => {
    const { client: c, calls } = client([ok({ valid: false, details: 'BR-CO-25 violated', info: null })]);
    const result = await c.validateInvoice(INPUT);
    expect(result.valid).toBe(false);
    expect(calls[0].url).toBe('http://fb.local/api/v1/validate');
  });
});
