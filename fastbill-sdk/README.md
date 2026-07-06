# @florinszilagyi/fastbill-sdk

Typed TypeScript client for the [fastbill](https://fastbill.app) e-Factura API — send Romanian
e-invoices through ANAF with an API key instead of OAuth certificates. This package is also the
**canonical API contract**: the fastbill server validates requests with the exact zod schemas
exported here, so client and server can never drift.

Node ≥ 18 (native `fetch`). Zero dependencies besides `zod`.

## Install

```bash
npm i @florinszilagyi/fastbill-sdk
```

## Quickstart

```typescript
import { FastbillClient } from '@florinszilagyi/fastbill-sdk';

const fastbill = new FastbillClient({ apiKey: process.env.FASTBILL_API_KEY! });

// companies your account can invoice for (SPV-verified via the dashboard)
const [company] = await fastbill.listCompanies();

// create (async — the API answers 202 and processes through a queue)
const { id } = await fastbill.createInvoice({
  companyId: company.id,
  invoiceNumber: 'FB-0042',
  issueDate: '2026-07-01',
  customerCui: 'RO12345678',
  lines: [{ description: 'Consulting', quantity: 10, unitPrice: 100, taxPercent: 19 }],
});

// block until ANAF validates or rejects it
const invoice = await fastbill.waitForInvoice(id, { onPoll: (i) => console.log(i.status) });

if (invoice.status === 'validated') {
  const zip = await fastbill.downloadZip(id); // ANAF-signed package
  const pdf = await fastbill.downloadPdf(id);
}
```

## Behavior you get for free

- **Idempotency**: `createInvoice` auto-generates an `Idempotency-Key` when you don't pass one, so
  network retries can never double-invoice. Replays return `{ replayed: true }`.
- **Retries**: 429 (honoring `Retry-After`), 5xx and network failures retry with exponential
  backoff (`maxRetries`, default 3). Other 4xx fail fast.
- **Typed errors**: failures throw `FastbillApiError { code, status, message, details }` —
  `FastbillRateLimitError` adds `retryAfterSeconds`; `waitForInvoice` throws
  `FastbillTimeoutError` when the budget runs out.
- **Pagination**: `iterateInvoices(filters)` is an async generator that follows cursors:

```typescript
for await (const inv of fastbill.iterateInvoices({ status: 'validated', from: '2026-01-01' })) {
  console.log(inv.invoiceNumber, inv.totalAmount);
}
```

- **Dry runs**: `validateInvoice(input)` builds the CIUS-RO UBL and runs ANAF's validator without
  creating anything (not quota-counted) — ideal in CI.

## Modes

`sk_test_…` keys target ANAF's **test** environment (unlimited, non-fiscal); `sk_live_…` keys are
fiscal and subject to the daily quota. `client.mode` tells you which one you hold. Point
`baseUrl` at a local fastbill instance for development.

## Error codes

`UNAUTHORIZED` · `FORBIDDEN` · `NOT_FOUND` · `INVALID_REQUEST` · `INVALID_INVOICE_INPUT` (422 with
per-field issue paths in `details`) · `COMPANY_NOT_FOUND` · `COMPANY_NOT_VERIFIED` ·
`GRANT_MISSING` / `GRANT_EXPIRED` (reconnect ANAF in the dashboard) · `QUOTA_EXCEEDED` ·
`RATE_LIMITED` · `ANAF_ERROR` · `INTERNAL`.

## Invoice lifecycle

`queued → building → uploaded → processing → validated | rejected | failed` (archived inbound
documents are `received`). Terminal invoices carry `error` details and `links` to
`xml` / `zip` / `pdf` downloads.
