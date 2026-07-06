'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { syncAllNow } from '@/app/dashboard/actions';

export function SyncAllButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      {msg && <span className="text-xs text-zinc-500">{msg}</span>}
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMsg(null);
            const res = await syncAllNow();
            if (!res.ok) {
              setMsg(res.error);
              return;
            }
            setMsg(`queued ${res.data?.queued ?? 0} compan${(res.data?.queued ?? 0) === 1 ? 'y' : 'ies'}`);
            router.refresh();
          })
        }
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? 'Queuing…' : 'Refresh archive'}
      </button>
    </div>
  );
}
