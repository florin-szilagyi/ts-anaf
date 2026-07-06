import { expect, test, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { INNGEST_EVENTS_FILE, SEED } from './support/env';

function authed(key: string): { Authorization: string } {
  return { Authorization: `Bearer ${key}` };
}

const VALID_INVOICE = {
  companyId: SEED.verifiedCompanyId,
  invoiceNumber: 'E2E-0001',
  issueDate: '2026-07-01',
  customerCui: 'RO99999999',
  lines: [{ description: 'E2E consulting', quantity: 2, unitPrice: 100, taxPercent: 19 }],
};

async function createInvoice(
  request: APIRequestContext,
  key: string,
  overrides: Record<string, unknown> = {},
  headers: Record<string, string> = {}
) {
  return request.post('/api/v1/invoices', {
    headers: { ...authed(key), ...headers },
    data: { ...VALID_INVOICE, ...overrides },
  });
}

test.describe('authentication', () => {
  test('rejects requests without a key', async ({ request }) => {
    const res = await request.get('/api/v1/companies');
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, error: { code: 'UNAUTHORIZED' } });
  });

  test('rejects malformed and unknown keys', async ({ request }) => {
    const malformed = await request.get('/api/v1/companies', { headers: authed('not-a-key') });
    expect(malformed.status()).toBe(401);

    const unknown = await request.get('/api/v1/companies', {
      headers: authed('sk_test_totally_unknown_key_000000000000000'),
    });
    expect(unknown.status()).toBe(401);
    expect((await unknown.json()).error.message).toContain('Unknown or revoked');
  });

  test('rejects revoked keys', async ({ request }) => {
    const res = await request.get('/api/v1/companies', { headers: authed(SEED.skRevoked) });
    expect(res.status()).toBe(401);
  });
});

test.describe('companies', () => {
  test('lists seeded companies with SPV status', async ({ request }) => {
    const res = await request.get('/api/v1/companies', { headers: authed(SEED.skTest) });
    expect(res.status()).toBe(200);
    const { success, data } = await res.json();
    expect(success).toBe(true);
    const byCif = Object.fromEntries(data.companies.map((c: { cif: string }) => [c.cif, c]));
    expect(byCif['11111111']).toMatchObject({ name: 'E2E Verified SRL', spvVerified: true });
    expect(byCif['22222222']).toMatchObject({ spvVerified: false });
  });
});

test.describe('invoice creation', () => {
  test('rejects invalid payloads with 422 and issue paths', async ({ request }) => {
    const res = await createInvoice(request, SEED.skTest, { issueDate: '01-07-2026', lines: [] });
    expect(res.status()).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_INVOICE_INPUT');
    const paths = body.error.details.issues.map((i: { path: string }) => i.path);
    expect(paths).toContain('issueDate');
    expect(paths).toContain('lines');
  });

  test('rejects non-JSON bodies with 400', async ({ request }) => {
    const res = await request.post('/api/v1/invoices', {
      headers: { ...authed(SEED.skTest), 'content-type': 'text/plain' },
      data: 'definitely not json',
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_REQUEST');
  });

  test('queues a test invoice (202), polls it, and emitted the Inngest event', async ({ request }) => {
    const res = await createInvoice(request, SEED.skTest, { invoiceNumber: 'E2E-QUEUE-1' });
    expect(res.status()).toBe(202);
    const { data } = await res.json();
    expect(data.status).toBe('queued');
    expect(data.id).toMatch(/^[0-9a-f-]{36}$/);

    const poll = await request.get(`/api/v1/invoices/${data.id}`, { headers: authed(SEED.skTest) });
    expect(poll.status()).toBe(200);
    const invoice = (await poll.json()).data;
    expect(invoice).toMatchObject({
      status: 'queued',
      mode: 'test',
      invoiceNumber: 'E2E-QUEUE-1',
      counterpartyCif: '99999999',
    });
    expect(invoice.links.self).toContain(`/api/v1/invoices/${data.id}`);

    const events = readFileSync(INNGEST_EVENTS_FILE, 'utf8');
    expect(events).toContain(data.id);
    expect(events).toContain('invoice/create.requested');
  });

  test('replays idempotency keys with 200 and the same invoice', async ({ request }) => {
    const first = await createInvoice(
      request,
      SEED.skTest,
      { invoiceNumber: 'E2E-IDEM-1' },
      { 'Idempotency-Key': 'e2e-idem-1' }
    );
    expect(first.status()).toBe(202);
    const firstId = (await first.json()).data.id;

    const replay = await createInvoice(
      request,
      SEED.skTest,
      { invoiceNumber: 'E2E-IDEM-1' },
      { 'Idempotency-Key': 'e2e-idem-1' }
    );
    expect(replay.status()).toBe(200);
    expect((await replay.json()).data.id).toBe(firstId);
  });

  test('blocks live invoices for unverified companies', async ({ request }) => {
    const res = await createInvoice(request, SEED.skLive, { companyId: SEED.unverifiedCompanyId });
    expect(res.status()).toBe(409);
    expect((await res.json()).error.code).toBe('COMPANY_NOT_VERIFIED');
  });

  test('cross-account company ids are rejected', async ({ request }) => {
    const res = await createInvoice(request, SEED.skLiveQuota, { companyId: SEED.verifiedCompanyId });
    expect(res.status()).toBe(404);
    expect((await res.json()).error.code).toBe('COMPANY_NOT_FOUND');
  });

  test('enforces the daily live quota atomically', async ({ request }) => {
    for (let i = 1; i <= SEED.quotaLimit; i++) {
      const res = await createInvoice(request, SEED.skLiveQuota, {
        companyId: SEED.quotaCompanyId,
        invoiceNumber: `E2E-QUOTA-${i}`,
      });
      expect(res.status(), `invoice ${i}/${SEED.quotaLimit} should pass`).toBe(202);
    }
    const overLimit = await createInvoice(request, SEED.skLiveQuota, {
      companyId: SEED.quotaCompanyId,
      invoiceNumber: 'E2E-QUOTA-OVER',
    });
    expect(overLimit.status()).toBe(429);
    const body = await overLimit.json();
    expect(body.error.code).toBe('QUOTA_EXCEEDED');
    expect(Number(overLimit.headers()['retry-after'])).toBeGreaterThan(0);
  });
});

test.describe('invoice listing', () => {
  test('is scoped to the key mode', async ({ request }) => {
    const testList = await request.get('/api/v1/invoices', { headers: authed(SEED.skTest) });
    const testInvoices = (await testList.json()).data.invoices;
    expect(testInvoices.length).toBeGreaterThan(0);
    for (const inv of testInvoices) expect(inv.mode).toBe('test');

    const liveList = await request.get('/api/v1/invoices', { headers: authed(SEED.skLive) });
    for (const inv of (await liveList.json()).data.invoices) expect(inv.mode).toBe('live');
  });

  test('filters by status and paginates with cursors', async ({ request }) => {
    // ensure at least 3 queued test invoices exist
    for (let i = 1; i <= 3; i++) {
      await createInvoice(request, SEED.skTest, { invoiceNumber: `E2E-LIST-${i}` });
    }
    const page1 = await request.get('/api/v1/invoices?status=queued&limit=2', { headers: authed(SEED.skTest) });
    expect(page1.status()).toBe(200);
    const d1 = (await page1.json()).data;
    expect(d1.invoices).toHaveLength(2);
    expect(d1.nextCursor).toBeTruthy();

    const page2 = await request.get(
      `/api/v1/invoices?status=queued&limit=2&cursor=${encodeURIComponent(d1.nextCursor)}`,
      {
        headers: authed(SEED.skTest),
      }
    );
    const d2 = (await page2.json()).data;
    const ids1 = new Set(d1.invoices.map((i: { id: string }) => i.id));
    for (const inv of d2.invoices) expect(ids1.has(inv.id)).toBe(false);
  });

  test('rejects bad filter values', async ({ request }) => {
    const res = await request.get('/api/v1/invoices?status=bogus', { headers: authed(SEED.skTest) });
    expect(res.status()).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_REQUEST');
  });

  test('404s on foreign invoice ids', async ({ request }) => {
    const res = await request.get('/api/v1/invoices/00000000-0000-4000-8000-000000000000', {
      headers: authed(SEED.skTest),
    });
    expect(res.status()).toBe(404);
  });
});
