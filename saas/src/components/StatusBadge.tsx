import type { InvoiceStatus } from '@/db/schema';

const STYLES: Record<InvoiceStatus, string> = {
  queued: 'bg-zinc-100 text-zinc-700',
  building: 'bg-blue-100 text-blue-700',
  uploaded: 'bg-blue-100 text-blue-700',
  processing: 'bg-amber-100 text-amber-800',
  validated: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-red-100 text-red-700',
  failed: 'bg-red-100 text-red-700',
  received: 'bg-indigo-100 text-indigo-700',
};

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLES[status] ?? STYLES.queued}`}>
      {status}
    </span>
  );
}
