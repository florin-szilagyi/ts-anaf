'use client';

import { useState, useTransition } from 'react';
import { createKey, revokeKey, rotateKey } from '@/app/dashboard/actions';
import type { ApiKeyMode } from '@/db/schema';

export interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  mode: ApiKeyMode;
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
}

export function ApiKeysPanel({ keys }: { keys: KeyRow[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<ApiKeyMode>('test');

  const run = (fn: () => Promise<{ ok: boolean; error?: string; data?: { secret: string } }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? 'failed');
      else if (res.data?.secret) setFreshSecret(res.data.secret);
    });

  return (
    <div className="space-y-6">
      {freshSecret && (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4">
          <p className="text-sm font-semibold">Copy this key now — it will not be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 text-xs">{freshSecret}</code>
            <button
              onClick={() => navigator.clipboard.writeText(freshSecret)}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-xs hover:bg-white"
            >
              Copy
            </button>
            <button onClick={() => setFreshSecret(null)} className="text-xs text-zinc-500 underline">
              done
            </button>
          </div>
        </div>
      )}

      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createKey(name, mode));
          setName('');
        }}
      >
        <label className="text-sm">
          <span className="text-zinc-600">Key name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="production backend"
            className="mt-1 block w-56 rounded-lg border border-zinc-300 px-3 py-2"
          />
        </label>
        <label className="text-sm">
          <span className="text-zinc-600">Mode</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as ApiKeyMode)}
            className="mt-1 block rounded-lg border border-zinc-300 px-3 py-2"
          >
            <option value="test">test</option>
            <option value="live">live</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={pending || !name.trim()}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          Create key
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-2.5">Name</th>
              <th className="px-4 py-2.5">Key</th>
              <th className="px-4 py-2.5">Mode</th>
              <th className="px-4 py-2.5">Created</th>
              <th className="px-4 py-2.5">Last used</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className={`border-t border-zinc-100 ${k.revoked ? 'opacity-50' : ''}`}>
                <td className="px-4 py-2.5">{k.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{k.prefix}…</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      k.mode === 'live' ? 'bg-emerald-100 text-emerald-800' : 'bg-zinc-100 text-zinc-600'
                    }`}
                  >
                    {k.mode}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-zinc-500">{k.createdAt.slice(0, 10)}</td>
                <td className="px-4 py-2.5 text-zinc-500">
                  {k.lastUsedAt ? k.lastUsedAt.slice(0, 16).replace('T', ' ') : 'never'}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {k.revoked ? (
                    <span className="text-xs text-zinc-400">revoked</span>
                  ) : (
                    <span className="flex justify-end gap-2 text-xs">
                      <button
                        disabled={pending}
                        onClick={() => run(() => rotateKey(k.id))}
                        className="rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-100"
                      >
                        Rotate
                      </button>
                      <button
                        disabled={pending}
                        onClick={() => {
                          if (confirm('Revoke this key? Requests using it will fail immediately.')) {
                            run(() => revokeKey(k.id));
                          }
                        }}
                        className="rounded-md border border-red-200 px-2 py-1 text-red-600 hover:bg-red-50"
                      >
                        Revoke
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                  No keys yet. Create a test key to try the API.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
