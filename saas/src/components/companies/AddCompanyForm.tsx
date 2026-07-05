'use client';

import { useState, useTransition } from 'react';
import { addCompany } from '@/app/dashboard/actions';

export function AddCompanyForm() {
  const [cui, setCui] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      className="flex items-start gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await addCompany(cui);
          if (!res.ok) setError(res.error);
          else setCui('');
        });
      }}
    >
      <div>
        <input
          value={cui}
          onChange={(e) => setCui(e.target.value)}
          placeholder="CUI (e.g. RO12345678)"
          className="w-56 rounded-lg border border-zinc-300 px-3 py-2 text-sm"
        />
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
      <button
        type="submit"
        disabled={pending || !cui.trim()}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
      >
        {pending ? 'Adding…' : 'Add company'}
      </button>
    </form>
  );
}
