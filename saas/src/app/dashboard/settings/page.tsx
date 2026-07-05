import { UserProfile } from '@clerk/nextjs';
import { auth } from '@clerk/nextjs/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { anafGrants } from '@/db/schema';
import { getQuotaUsage } from '@/lib/quota';

export default async function SettingsPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const [grant] = await db
    .select()
    .from(anafGrants)
    .where(and(eq(anafGrants.userId, userId), eq(anafGrants.status, 'active')))
    .limit(1);
  const quota = await getQuotaUsage(db, userId);

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section className="max-w-xl rounded-2xl border border-zinc-200 bg-white p-5 text-sm">
        <h2 className="font-semibold">ANAF connection</h2>
        {grant ? (
          <dl className="mt-3 space-y-1 text-zinc-600">
            <div>Authorized: {grant.refreshTokenObtainedAt.toISOString().slice(0, 10)}</div>
            <div>Access token valid until: {grant.accessTokenExpiresAt?.toISOString().slice(0, 10) ?? '—'}</div>
            <div>Token rotations: {grant.tokenVersion}</div>
            {grant.lastError && <div className="text-red-600">Last error: {grant.lastError}</div>}
          </dl>
        ) : (
          <p className="mt-2 text-zinc-600">Not connected.</p>
        )}
        <a
          href="/api/anaf/connect"
          className="mt-3 inline-block rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
        >
          {grant ? 'Reconnect' : 'Connect'} ANAF
        </a>
      </section>

      <section className="max-w-xl rounded-2xl border border-zinc-200 bg-white p-5 text-sm">
        <h2 className="font-semibold">Limits</h2>
        <p className="mt-2 text-zinc-600">
          Live invoices: {quota.used}/{quota.limit} today. Need more? Reach out — the limit is per-account adjustable.
        </p>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Account</h2>
        <UserProfile routing="hash" />
      </section>
    </div>
  );
}
