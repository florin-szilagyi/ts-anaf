import { auth } from '@clerk/nextjs/server';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { apiKeys } from '@/db/schema';
import { ApiKeysPanel } from '@/components/keys/ApiKeysPanel';

export default async function ApiKeysPage() {
  const { userId } = await auth();
  if (!userId) return null;

  const rows = await db.select().from(apiKeys).where(eq(apiKeys.userId, userId)).orderBy(desc(apiKeys.createdAt));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">API keys</h1>
      <p className="max-w-2xl text-sm text-zinc-600">
        Authenticate with <code className="rounded bg-zinc-100 px-1">Authorization: Bearer sk_…</code>. Test keys hit
        ANAF&apos;s test environment and don&apos;t count toward the daily live quota. Rotating creates a replacement
        and revokes the old key in one step.
      </p>
      <ApiKeysPanel
        keys={rows.map((k) => ({
          id: k.id,
          name: k.name,
          prefix: k.prefix,
          mode: k.mode,
          createdAt: k.createdAt.toISOString(),
          lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
          revoked: Boolean(k.revokedAt),
        }))}
      />
    </div>
  );
}
