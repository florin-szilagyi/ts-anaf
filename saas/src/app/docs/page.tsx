import Link from 'next/link';

const CREATE_BODY = `{
  "companyId": "8f14e45f-…",          // from GET /api/v1/companies
  "invoiceNumber": "FB-0042",
  "issueDate": "2026-07-01",
  "dueDate": "2026-07-31",             // optional
  "customerCui": "RO12345678",
  "currency": "RON",                   // optional, default RON
  "note": "Thanks!",                   // optional
  "paymentIban": "RO49AAAA1B31007593840000", // optional
  "lines": [
    {
      "description": "Consulting",
      "quantity": 10,
      "unitPrice": 100,
      "taxPercent": 19,
      "unitCode": "EA"                 // optional, UN/ECE
    }
  ],
  "overrides": {                       // optional party overrides
    "customer": { "address": { "postalZone": "010101" } }
  }
}`;

const SECTIONS: Array<{ method: string; path: string; body: string }> = [
  {
    method: 'POST',
    path: '/api/v1/invoices',
    body: 'Create an invoice (async). Returns 202 with {id, status:"queued"}. Send an Idempotency-Key header to make retries safe — replays return the existing invoice with 200. Live mode requires SPV-verified companies and counts toward the daily quota (default 10/day; test mode is uncounted).',
  },
  {
    method: 'GET',
    path: '/api/v1/invoices/{id}',
    body: 'Poll invoice state: queued → building → uploaded → processing → validated | rejected | failed. Terminal states carry error details and download links. Poll every ≥30s — ANAF validation can take minutes.',
  },
  {
    method: 'GET',
    path: '/api/v1/invoices',
    body: "List invoices scoped to your key's mode. Filters: direction (outbound|inbound), status, from/to (issue date, YYYY-MM-DD), counterparty_cif, company_id, limit (≤100), cursor (opaque keyset cursor from nextCursor).",
  },
  {
    method: 'GET',
    path: '/api/v1/invoices/{id}/xml | /zip | /pdf',
    body: "302-redirects to a short-lived download URL. xml = the CIUS-RO UBL we generated (or archived), zip = ANAF's signed package, pdf = rendered by ANAF (generated lazily on first request).",
  },
  {
    method: 'GET',
    path: '/api/v1/companies',
    body: 'Your companies with SPV verification and archive status. Use the returned id as companyId when creating invoices.',
  },
  {
    method: 'POST',
    path: '/api/v1/validate',
    body: "Same payload as POST /invoices, but synchronous and side-effect-free: builds the UBL XML and runs ANAF's validator. Not quota-counted. Ideal in CI.",
  },
];

export default function DocsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900">
        ← fastbill
      </Link>
      <h1 className="mt-4 text-3xl font-bold">API reference</h1>

      <section className="mt-8 space-y-3 text-sm leading-relaxed text-zinc-700">
        <h2 className="text-xl font-semibold text-zinc-900">Authentication</h2>
        <p>
          Every request needs{' '}
          <code className="rounded bg-zinc-100 px-1">Authorization: Bearer sk_test_… | sk_live_…</code>. Create keys in
          the dashboard. <strong>Test keys</strong> target ANAF&apos;s test environment; <strong>live keys</strong> are
          fiscal. Keys are rotateable and revocable instantly.
        </p>
        <h2 className="text-xl font-semibold text-zinc-900">Envelope & errors</h2>
        <p>
          Success: <code className="rounded bg-zinc-100 px-1">{'{"success":true,"data":{…}}'}</code>. Errors:{' '}
          <code className="rounded bg-zinc-100 px-1">{'{"success":false,"error":{"code","message","details?"}}'}</code>{' '}
          with codes like <code>INVALID_INVOICE_INPUT</code>, <code>QUOTA_EXCEEDED</code>, <code>RATE_LIMITED</code>{' '}
          (429 + Retry-After), <code>COMPANY_NOT_VERIFIED</code>, <code>GRANT_EXPIRED</code>.
        </p>
        <h2 className="text-xl font-semibold text-zinc-900">Rate limits</h2>
        <p>
          60 requests/min per key, 120/min per account, and 10 live invoices/day by default. 429 responses include{' '}
          <code>Retry-After</code>.
        </p>
      </section>

      <section className="mt-10 space-y-6">
        <h2 className="text-xl font-semibold">Endpoints</h2>
        {SECTIONS.map((s) => (
          <div key={s.path} className="rounded-2xl border border-zinc-200 bg-white p-5">
            <p className="font-mono text-sm">
              <span className="mr-2 rounded bg-zinc-900 px-2 py-0.5 text-xs font-bold text-white">{s.method}</span>
              {s.path}
            </p>
            <p className="mt-2 text-sm text-zinc-600">{s.body}</p>
          </div>
        ))}
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold">Create-invoice payload</h2>
        <pre className="mt-4 overflow-x-auto rounded-2xl bg-zinc-900 p-5 text-xs leading-relaxed text-zinc-100">
          <code>{CREATE_BODY}</code>
        </pre>
        <p className="mt-3 text-sm text-zinc-600">
          Party data (names, addresses, VAT status) is resolved automatically from the public ANAF registry for both
          CUIs, including CIUS-RO county codes and Bucharest SECTOR rules; use <code>overrides</code> only when the
          registry data needs correcting.
        </p>
      </section>
    </main>
  );
}
