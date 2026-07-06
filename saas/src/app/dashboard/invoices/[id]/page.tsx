import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { companies, invoices } from '@/db/schema';
import { StatusBadge } from '@/components/StatusBadge';

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return null;
  const { id } = await params;

  const [row] = await db
    .select()
    .from(invoices)
    .leftJoin(companies, eq(invoices.companyId, companies.id))
    .where(and(eq(invoices.id, id), eq(invoices.userId, userId)))
    .limit(1);
  if (!row) notFound();
  const inv = row.invoices;
  const company = row.companies;

  const files: Array<{ kind: string; label: string; available: boolean }> = [
    { kind: 'xml', label: 'Invoice XML', available: Boolean(inv.xmlStorageKey) },
    { kind: 'zip', label: 'Signed ZIP (ANAF)', available: Boolean(inv.zipStorageKey) },
    { kind: 'pdf', label: 'PDF', available: Boolean(inv.xmlStorageKey) },
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{inv.invoiceNumber ?? inv.id.slice(0, 8)}</h1>
        <StatusBadge status={inv.status} />
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2">
          <dt className="text-zinc-500">Company</dt>
          <dd>{company ? `${company.name} (${company.cif})` : '—'}</dd>
          <dt className="text-zinc-500">Direction</dt>
          <dd>{inv.direction}</dd>
          <dt className="text-zinc-500">Mode</dt>
          <dd>{inv.mode}</dd>
          <dt className="text-zinc-500">Counterparty</dt>
          <dd>{inv.counterpartyName ?? inv.counterpartyCif ?? '—'}</dd>
          <dt className="text-zinc-500">Issue date</dt>
          <dd>{inv.issueDate ?? '—'}</dd>
          <dt className="text-zinc-500">Due date</dt>
          <dd>{inv.dueDate ?? '—'}</dd>
          <dt className="text-zinc-500">Total</dt>
          <dd>{inv.totalAmount ? `${inv.totalAmount} ${inv.currency} (VAT ${inv.taxAmount})` : '—'}</dd>
          <dt className="text-zinc-500">ANAF upload index</dt>
          <dd className="font-mono text-xs">{inv.anafUploadIndex ?? '—'}</dd>
          <dt className="text-zinc-500">ANAF download id</dt>
          <dd className="font-mono text-xs">{inv.anafDownloadId ?? '—'}</dd>
          <dt className="text-zinc-500">Created</dt>
          <dd>{inv.createdAt.toISOString()}</dd>
          <dt className="text-zinc-500">Finalized</dt>
          <dd>{inv.finalizedAt?.toISOString() ?? '—'}</dd>
        </dl>
      </div>

      {inv.error != null && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
          <h2 className="text-sm font-semibold text-red-800">Error details</h2>
          <pre className="mt-2 overflow-x-auto text-xs text-red-900">{JSON.stringify(inv.error, null, 2)}</pre>
        </div>
      )}

      <div className="rounded-2xl border border-zinc-200 bg-white p-5">
        <h2 className="text-sm font-semibold">Downloads</h2>
        <div className="mt-3 flex gap-2">
          {files.map((f) =>
            f.available ? (
              <a
                key={f.kind}
                href={`/dashboard/invoices/${inv.id}/download/${f.kind}`}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100"
              >
                {f.label}
              </a>
            ) : (
              <span key={f.kind} className="rounded-lg border border-zinc-200 px-3 py-1.5 text-sm text-zinc-400">
                {f.label}
              </span>
            )
          )}
        </div>
      </div>

      {inv.requestInput != null && (
        <details className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm">
          <summary className="cursor-pointer font-semibold">Raw request payload</summary>
          <pre className="mt-3 overflow-x-auto text-xs text-zinc-700">{JSON.stringify(inv.requestInput, null, 2)}</pre>
        </details>
      )}

      <Link href="/dashboard/invoices" className="inline-block text-sm text-zinc-500 underline">
        ← Back to invoices
      </Link>
    </div>
  );
}
