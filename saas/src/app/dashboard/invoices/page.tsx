import { auth } from '@clerk/nextjs/server';
import { and, desc, eq, type SQL } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '@/db';
import { invoices, invoiceDirections, invoiceStatuses } from '@/db/schema';
import { StatusBadge } from '@/components/StatusBadge';

const PAGE_SIZE = 25;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ direction?: string; status?: string; page?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) return null;
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);

  const filters: SQL[] = [eq(invoices.userId, userId)];
  if (params.direction && (invoiceDirections as readonly string[]).includes(params.direction)) {
    filters.push(eq(invoices.direction, params.direction as (typeof invoiceDirections)[number]));
  }
  if (params.status && (invoiceStatuses as readonly string[]).includes(params.status)) {
    filters.push(eq(invoices.status, params.status as (typeof invoiceStatuses)[number]));
  }

  const rows = await db
    .select()
    .from(invoices)
    .where(and(...filters))
    .orderBy(desc(invoices.createdAt), desc(invoices.id))
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE);
  const hasNext = rows.length > PAGE_SIZE;
  const list = rows.slice(0, PAGE_SIZE);

  const filterLink = (kv: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const merged = { direction: params.direction, status: params.status, ...kv };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    const s = q.toString();
    return `/dashboard/invoices${s ? `?${s}` : ''}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Invoices</h1>
        <Link
          href="/dashboard/invoices/new"
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
        >
          New invoice
        </Link>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <Link href={filterLink({ direction: undefined })} className={chip(!params.direction)}>
          all
        </Link>
        <Link href={filterLink({ direction: 'outbound' })} className={chip(params.direction === 'outbound')}>
          sent
        </Link>
        <Link href={filterLink({ direction: 'inbound' })} className={chip(params.direction === 'inbound')}>
          received
        </Link>
        <span className="mx-2 text-zinc-300">|</span>
        {(['validated', 'processing', 'rejected', 'failed', 'received'] as const).map((s) => (
          <Link
            key={s}
            href={filterLink({ status: params.status === s ? undefined : s })}
            className={chip(params.status === s)}
          >
            {s}
          </Link>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2.5">Number</th>
              <th className="px-4 py-2.5">Dir</th>
              <th className="px-4 py-2.5">Counterparty</th>
              <th className="px-4 py-2.5">Issue date</th>
              <th className="px-4 py-2.5">Total</th>
              <th className="px-4 py-2.5">Mode</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {list.map((inv) => (
              <tr key={inv.id} className="border-t border-zinc-100">
                <td className="px-4 py-2.5">
                  <Link href={`/dashboard/invoices/${inv.id}`} className="font-medium hover:underline">
                    {inv.invoiceNumber ?? inv.id.slice(0, 8)}
                  </Link>
                </td>
                <td className="px-4 py-2.5">{inv.direction === 'outbound' ? '→' : '←'}</td>
                <td className="px-4 py-2.5 text-zinc-600">{inv.counterpartyName ?? inv.counterpartyCif ?? '—'}</td>
                <td className="px-4 py-2.5 text-zinc-600">{inv.issueDate ?? '—'}</td>
                <td className="px-4 py-2.5">{inv.totalAmount ? `${inv.totalAmount} ${inv.currency}` : '—'}</td>
                <td className="px-4 py-2.5 text-zinc-500">{inv.mode}</td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={inv.status} />
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                  No invoices match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 text-sm">
        {page > 1 && (
          <Link
            href={filterLink({ page: String(page - 1) })}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100"
          >
            ← Prev
          </Link>
        )}
        {hasNext && (
          <Link
            href={filterLink({ page: String(page + 1) })}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100"
          >
            Next →
          </Link>
        )}
      </div>
    </div>
  );
}

function chip(active: boolean): string {
  return `rounded-full border px-3 py-1 ${active ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100'}`;
}
