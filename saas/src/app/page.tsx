import { SignedIn, SignedOut, SignInButton } from '@clerk/nextjs';
import Link from 'next/link';

const CURL_EXAMPLE = `# 1. Create an invoice (async — returns 202 + id)
curl -X POST https://fastbill.app/api/v1/invoices \\
  -H "Authorization: Bearer sk_test_..." \\
  -H "Idempotency-Key: inv-2026-0042" \\
  -d '{
    "companyId": "…",
    "invoiceNumber": "FB-0042",
    "issueDate": "2026-07-01",
    "customerCui": "RO12345678",
    "lines": [
      { "description": "Consulting", "quantity": 10, "unitPrice": 100, "taxPercent": 19 }
    ]
  }'

# 2. Poll until ANAF validates it
curl https://fastbill.app/api/v1/invoices/{id} \\
  -H "Authorization: Bearer sk_test_..."
# → { "status": "validated", "links": { "zip": "...", "pdf": "..." } }`;

const FEATURES: Array<{ title: string; body: string }> = [
  {
    title: 'Connect once, invoice everywhere',
    body: 'Log in with your qualified certificate a single time. The same ANAF authorization serves every company you hold SPV rights over — no per-company setup.',
  },
  {
    title: 'A real REST API for e-Factura',
    body: 'Test and live API keys (sk_test / sk_live), async invoice creation with idempotency keys, status polling, XML/PDF/ZIP downloads. CIUS-RO UBL is generated for you.',
  },
  {
    title: 'Your permanent archive',
    body: 'ANAF deletes messages after 60 days. fastbill syncs every company daily, stores the signed documents durably and keeps searchable metadata forever.',
  },
  {
    title: 'Free, with honest limits',
    body: '10 live invoices per day per account, unlimited test invoices, generous query limits. No card, no trial clock.',
  },
];

export default function LandingPage() {
  return (
    <main className="mx-auto max-w-5xl px-6">
      <header className="flex items-center justify-between py-6">
        <span className="text-xl font-bold tracking-tight">fastbill</span>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/docs" className="text-zinc-600 hover:text-zinc-900">
            API docs
          </Link>
          <SignedOut>
            <SignInButton mode="modal">
              <button className="rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700">
                Sign in
              </button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <Link
              href="/dashboard"
              className="rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700"
            >
              Dashboard
            </Link>
          </SignedIn>
        </nav>
      </header>

      <section className="py-20 text-center">
        <h1 className="mx-auto max-w-3xl text-5xl font-bold tracking-tight">
          e-Factura API in one afternoon. <span className="text-emerald-600">Free.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-600">
          fastbill wraps ANAF e-Factura in a clean REST API and a simple dashboard: send invoices, query everything, and
          keep a permanent archive — for every company your certificate can access.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <SignedOut>
            <SignInButton mode="modal">
              <button className="rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white hover:bg-emerald-500">
                Start free
              </button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <Link
              href="/dashboard"
              className="rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white hover:bg-emerald-500"
            >
              Open dashboard
            </Link>
          </SignedIn>
          <Link
            href="/docs"
            className="rounded-lg border border-zinc-300 px-6 py-3 font-semibold text-zinc-700 hover:bg-zinc-100"
          >
            Read the docs
          </Link>
        </div>
      </section>

      <section className="grid gap-6 py-12 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-2xl border border-zinc-200 bg-white p-6">
            <h3 className="text-lg font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="py-12">
        <h2 className="text-center text-2xl font-bold">Two requests to production</h2>
        <pre className="mt-6 overflow-x-auto rounded-2xl bg-zinc-900 p-6 text-sm leading-relaxed text-zinc-100">
          <code>{CURL_EXAMPLE}</code>
        </pre>
      </section>

      <section className="py-12">
        <h2 className="text-2xl font-bold">FAQ</h2>
        <dl className="mt-6 space-y-6 text-sm">
          <div>
            <dt className="font-semibold">Do I need my USB token / qualified certificate?</dt>
            <dd className="mt-1 text-zinc-600">
              Once. ANAF requires the certificate for the initial login (it happens in your browser, on
              logincert.anaf.ro — fastbill never sees the certificate). After that, fastbill maintains the authorization
              for you and warns you before it expires (~12 months).
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Multiple companies?</dt>
            <dd className="mt-1 text-zinc-600">
              Yes — the ANAF authorization belongs to you, not to a company. Add every CIF you hold SPV rights over and
              invoice for all of them with the same connection.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">What does test mode do?</dt>
            <dd className="mt-1 text-zinc-600">
              sk_test keys target ANAF&apos;s test environment: full pipeline, no fiscal consequences, no daily limit.
              Flip to your sk_live key when you are ready.
            </dd>
          </div>
          <div>
            <dt className="font-semibold">Why free?</dt>
            <dd className="mt-1 text-zinc-600">
              e-Factura is mandatory; the tooling shouldn&apos;t be a tax on top of a tax. Fair-use limits keep it
              sustainable.
            </dd>
          </div>
        </dl>
      </section>

      <footer className="border-t border-zinc-200 py-10 text-center text-sm text-zinc-500">
        fastbill — built on the open-source{' '}
        <a className="underline" href="https://github.com/florin-szilagyi/ts-anaf">
          anaf-ts-sdk
        </a>
        . Not affiliated with ANAF.
      </footer>
    </main>
  );
}
