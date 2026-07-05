'use client';

import { useState, useTransition } from 'react';
import { removeCompany, reverifyCompany, syncNow, toggleArchive } from '@/app/dashboard/actions';

export function CompanyActions({
  companyId,
  archiveEnabled,
  verified,
}: {
  companyId: string;
  archiveEnabled: boolean;
  verified: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) =>
    startTransition(async () => {
      setMsg(null);
      const res = await fn();
      setMsg(res.ok ? (okMsg ?? null) : (res.error ?? 'failed'));
    });

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {!verified && (
        <button
          disabled={pending}
          onClick={() => run(() => reverifyCompany(companyId), 'checked')}
          className="rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-100 disabled:opacity-50"
        >
          Re-check SPV
        </button>
      )}
      <button
        disabled={pending}
        onClick={() => run(() => toggleArchive(companyId, !archiveEnabled))}
        className="rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-100 disabled:opacity-50"
      >
        {archiveEnabled ? 'Disable archive' : 'Enable archive'}
      </button>
      <button
        disabled={pending}
        onClick={() => run(() => syncNow(companyId), 'sync queued')}
        className="rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-100 disabled:opacity-50"
      >
        Sync now
      </button>
      <button
        disabled={pending}
        onClick={() => {
          if (confirm('Remove this company and all its archived invoices from fastbill?')) {
            run(() => removeCompany(companyId));
          }
        }}
        className="rounded-md border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        Remove
      </button>
      {msg && <span className="text-zinc-500">{msg}</span>}
    </div>
  );
}
