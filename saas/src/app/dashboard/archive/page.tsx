import { auth } from '@clerk/nextjs/server';
import { desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { companies, syncRuns } from '@/db/schema';
import { SyncAllButton } from '@/components/archive/SyncAllButton';

export default async function ArchivePage() {
  const { userId } = await auth();
  if (!userId) return null;

  const myCompanies = await db.select().from(companies).where(eq(companies.userId, userId));
  const companyIds = myCompanies.map((c) => c.id);
  const runs = companyIds.length
    ? await db
        .select()
        .from(syncRuns)
        .where(inArray(syncRuns.companyId, companyIds))
        .orderBy(desc(syncRuns.startedAt))
        .limit(30)
    : [];
  const nameById = new Map(myCompanies.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Archive</h1>
        <SyncAllButton />
      </div>
      <p className="max-w-2xl text-sm text-zinc-600">
        fastbill syncs every company daily (ANAF only keeps messages ~60 days). Documents land in durable storage;
        metadata is searchable under Invoices. “Refresh archive” queues an immediate sync for all companies; a company
        card&apos;s “Sync now” does the same for one.
      </p>

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2.5">Company</th>
              <th className="px-4 py-2.5">Started</th>
              <th className="px-4 py-2.5">Window</th>
              <th className="px-4 py-2.5">Found</th>
              <th className="px-4 py-2.5">New</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100">
                <td className="px-4 py-2.5">{nameById.get(r.companyId) ?? r.companyId.slice(0, 8)}</td>
                <td className="px-4 py-2.5 text-zinc-500">
                  {r.startedAt.toISOString().slice(0, 16).replace('T', ' ')}
                </td>
                <td className="px-4 py-2.5 text-zinc-500">
                  {r.windowStart.toISOString().slice(0, 10)} → {r.windowEnd.toISOString().slice(0, 10)}
                </td>
                <td className="px-4 py-2.5">{r.messagesFound}</td>
                <td className="px-4 py-2.5">{r.messagesNew}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      r.status === 'ok'
                        ? 'bg-emerald-100 text-emerald-800'
                        : r.status === 'running'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                  No sync runs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
