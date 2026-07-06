import { auth, currentUser } from '@clerk/nextjs/server';
import { and, desc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '@/db';
import { anafGrants, companies, invoices } from '@/db/schema';
import { StatusBadge } from '@/components/StatusBadge';
import { getQuotaUsage } from '@/lib/quota';
import { ensureUser } from '@/lib/users';

export default async function OverviewPage() {
  const { userId } = await auth();
  if (!userId) return null;
  const user = await currentUser();
  await ensureUser(db, userId, user?.primaryEmailAddress?.emailAddress);

  const [grant] = await db
    .select()
    .from(anafGrants)
    .where(and(eq(anafGrants.userId, userId), eq(anafGrants.status, 'active')))
    .limit(1);
  const companyCount = (await db.select({ id: companies.id }).from(companies).where(eq(companies.userId, userId)))
    .length;
  const quota = await getQuotaUsage(db, userId);
  const recent = await db
    .select()
    .from(invoices)
    .where(eq(invoices.userId, userId))
    .orderBy(desc(invoices.createdAt))
    .limit(8);

  const refreshAgeDays = grant ? Math.floor((Date.now() - grant.refreshTokenObtainedAt.getTime()) / 86_400_000) : 0;
  const reconnectSoon = grant && refreshAgeDays > 330;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Overview</h1>

      {!grant && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium">Connect ANAF to start invoicing.</p>
          <p className="mt-1 text-zinc-600">
            You&apos;ll sign in once with your qualified certificate; fastbill keeps the authorization alive after that.
          </p>
          <a
            href="/api/anaf/connect"
            className="mt-3 inline-block rounded-lg bg-zinc-900 px-4 py-2 font-medium text-white hover:bg-zinc-700"
          >
            Connect ANAF
          </a>
        </div>
      )}
      {reconnectSoon && (
        <div className="rounded-2xl border border-red-300 bg-red-50 p-4 text-sm">
          <p className="font-medium">Your ANAF authorization expires soon ({365 - refreshAgeDays} days left).</p>
          <a href="/api/anaf/connect" className="mt-2 inline-block font-medium underline">
            Reconnect with your certificate
          </a>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          <p className="text-sm text-zinc-500">ANAF connection</p>
          <p className="mt-1 text-lg font-semibold">{grant ? 'Connected' : 'Not connected'}</p>
          {grant && <p className="text-xs text-zinc-500">authorized {refreshAgeDays} days ago</p>}
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          <p className="text-sm text-zinc-500">Companies</p>
          <p className="mt-1 text-lg font-semibold">{companyCount}</p>
          <Link href="/dashboard/companies" className="text-xs text-emerald-700 underline">
            manage
          </Link>
        </div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-5">
          <p className="text-sm text-zinc-500">Live invoices today</p>
          <p className="mt-1 text-lg font-semibold">
            {quota.used} / {quota.limit}
          </p>
          <p className="text-xs text-zinc-500">test mode is unlimited</p>
        </div>
      </div>

      <section>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent invoices</h2>
          <Link
            href="/dashboard/invoices/new"
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500"
          >
            New invoice
          </Link>
        </div>
        <div className="mt-3 overflow-hidden rounded-2xl border border-zinc-200 bg-white">
          {recent.length === 0 ? (
            <p className="p-6 text-sm text-zinc-500">Nothing yet. Create your first invoice or run an archive sync.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {recent.map((inv) => (
                  <tr key={inv.id} className="border-b border-zinc-100 last:border-0">
                    <td className="px-4 py-2.5">
                      <Link href={`/dashboard/invoices/${inv.id}`} className="font-medium hover:underline">
                        {inv.invoiceNumber ?? inv.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-zinc-500">{inv.counterpartyName ?? inv.counterpartyCif ?? '—'}</td>
                    <td className="px-4 py-2.5">{inv.totalAmount ? `${inv.totalAmount} ${inv.currency}` : '—'}</td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={inv.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
