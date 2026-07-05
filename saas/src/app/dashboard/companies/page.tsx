import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { anafGrants, companies } from '@/db/schema';
import { AddCompanyForm } from '@/components/companies/AddCompanyForm';
import { CompanyActions } from '@/components/companies/CompanyActions';

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; connect_error?: string }>;
}) {
  const { userId } = await auth();
  if (!userId) return null;
  const params = await searchParams;

  const [grant] = await db
    .select()
    .from(anafGrants)
    .where(and(eq(anafGrants.userId, userId), eq(anafGrants.status, 'active')))
    .limit(1);
  const rows = await db.select().from(companies).where(eq(companies.userId, userId));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Companies</h1>
        {!grant ? (
          <a
            href="/api/anaf/connect"
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Connect ANAF
          </a>
        ) : (
          <a href="/api/anaf/connect" className="text-sm text-zinc-500 underline">
            Reconnect ANAF
          </a>
        )}
      </div>

      {params.connected && (
        <p className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm">
          ANAF connected. Add the companies you hold SPV rights over — the same connection covers all of them.
        </p>
      )}
      {params.connect_error && (
        <p className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm">
          ANAF connection failed ({params.connect_error}). Common causes: wrong certificate selected, or the login took
          longer than the 60-second window — try again.
        </p>
      )}

      <AddCompanyForm />

      <div className="grid gap-4 sm:grid-cols-2">
        {rows.map((c) => (
          <div key={c.id} className="rounded-2xl border border-zinc-200 bg-white p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold">{c.name}</h3>
                <p className="text-sm text-zinc-500">CUI {c.cif}</p>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  c.spvVerifiedAt ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                }`}
              >
                {c.spvVerifiedAt ? 'SPV verified' : 'unverified'}
              </span>
            </div>
            <dl className="mt-3 space-y-1 text-xs text-zinc-500">
              <div>VAT payer: {c.vatPayer ? 'yes' : 'no'}</div>
              <div>Archive: {c.archiveEnabled ? 'weekly sync on' : 'off'}</div>
              <div>Last sync: {c.lastSyncAt ? c.lastSyncAt.toISOString().slice(0, 16).replace('T', ' ') : 'never'}</div>
            </dl>
            <div className="mt-4">
              <CompanyActions companyId={c.id} archiveEnabled={c.archiveEnabled} verified={Boolean(c.spvVerifiedAt)} />
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-sm text-zinc-500">
            No companies yet. {grant ? 'Add one by CUI above.' : 'Connect ANAF, then add your companies by CUI.'}
          </p>
        )}
      </div>
    </div>
  );
}
