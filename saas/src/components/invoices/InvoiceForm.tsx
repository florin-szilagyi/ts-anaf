'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createInvoiceAction, lookupCompany } from '@/app/dashboard/actions';
import type { ApiKeyMode } from '@/db/schema';
import type { CreateInvoiceInput } from '@/lib/validation/invoiceInput';

interface CompanyOption {
  id: string;
  name: string;
  cif: string;
  verified: boolean;
}

interface LineDraft {
  description: string;
  quantity: string;
  unitPrice: string;
  taxPercent: string;
}

const EMPTY_LINE: LineDraft = { description: '', quantity: '1', unitPrice: '', taxPercent: '19' };

export function InvoiceForm({ companies }: { companies: CompanyOption[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ApiKeyMode>('test');
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? '');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [customerCui, setCustomerCui] = useState('');
  const [customerName, setCustomerName] = useState<string | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([{ ...EMPTY_LINE }]);

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const checkCustomer = () => {
    if (!customerCui.trim()) return;
    startTransition(async () => {
      const res = await lookupCompany(customerCui);
      setCustomerName(res.ok && res.data ? res.data.name : null);
      if (!res.ok) setError(res.error);
    });
  };

  const submit = () => {
    setError(null);
    const input: CreateInvoiceInput = {
      companyId,
      invoiceNumber,
      issueDate,
      ...(dueDate ? { dueDate } : {}),
      customerCui: customerCui.trim(),
      lines: lines.map((l) => ({
        description: l.description,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        taxPercent: Number(l.taxPercent),
      })),
    };
    startTransition(async () => {
      const res = await createInvoiceAction(mode, input);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/dashboard/invoices/${res.data?.id}`);
    });
  };

  const total = lines.reduce((acc, l) => {
    const net = Number(l.quantity) * Number(l.unitPrice) || 0;
    return acc + net * (1 + (Number(l.taxPercent) || 0) / 100);
  }, 0);

  return (
    <div className="max-w-2xl space-y-5">
      <div className="flex gap-3">
        <label className="flex-1 text-sm">
          <span className="text-zinc-600">Supplier company</span>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
          >
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.cif}){c.verified ? '' : ' — unverified'}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="text-zinc-600">Mode</span>
          <div className="mt-1 flex overflow-hidden rounded-lg border border-zinc-300">
            {(['test', 'live'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-4 py-2 ${mode === m ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600'}`}
              >
                {m}
              </button>
            ))}
          </div>
        </label>
      </div>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <label>
          <span className="text-zinc-600">Invoice number</span>
          <input
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder="FB-0001"
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
          />
        </label>
        <label>
          <span className="text-zinc-600">Issue date</span>
          <input
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
          />
        </label>
        <label>
          <span className="text-zinc-600">Due date (optional)</span>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="mt-1 w-full rounded-lg border border-zinc-300 px-3 py-2"
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="text-zinc-600">Customer CUI</span>
        <div className="mt-1 flex gap-2">
          <input
            value={customerCui}
            onChange={(e) => setCustomerCui(e.target.value)}
            onBlur={checkCustomer}
            placeholder="RO12345678"
            className="w-56 rounded-lg border border-zinc-300 px-3 py-2"
          />
          {customerName && <span className="self-center text-zinc-500">{customerName}</span>}
        </div>
      </label>

      <div className="space-y-2">
        <span className="text-sm text-zinc-600">Lines</span>
        {lines.map((l, i) => (
          <div key={i} className="flex gap-2 text-sm">
            <input
              value={l.description}
              onChange={(e) => setLine(i, { description: e.target.value })}
              placeholder="Description"
              className="flex-1 rounded-lg border border-zinc-300 px-3 py-2"
            />
            <input
              value={l.quantity}
              onChange={(e) => setLine(i, { quantity: e.target.value })}
              placeholder="Qty"
              className="w-20 rounded-lg border border-zinc-300 px-3 py-2"
            />
            <input
              value={l.unitPrice}
              onChange={(e) => setLine(i, { unitPrice: e.target.value })}
              placeholder="Unit price"
              className="w-28 rounded-lg border border-zinc-300 px-3 py-2"
            />
            <input
              value={l.taxPercent}
              onChange={(e) => setLine(i, { taxPercent: e.target.value })}
              placeholder="VAT %"
              className="w-20 rounded-lg border border-zinc-300 px-3 py-2"
            />
            {lines.length > 1 && (
              <button
                type="button"
                onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                className="rounded-lg border border-zinc-300 px-3 text-zinc-500 hover:bg-zinc-100"
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setLines((prev) => [...prev, { ...EMPTY_LINE }])}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100"
        >
          + Add line
        </button>
      </div>

      <div className="flex items-center justify-between border-t border-zinc-200 pt-4">
        <span className="text-sm text-zinc-600">
          Total (incl. VAT): <strong>{total.toFixed(2)} RON</strong>
        </span>
        <button
          type="button"
          disabled={pending || !companyId || !invoiceNumber || !customerCui}
          onClick={submit}
          className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          {pending ? 'Queuing…' : `Create ${mode} invoice`}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-xs text-zinc-500">
        Invoices are processed asynchronously: fastbill builds the CIUS-RO XML, uploads it to ANAF and polls until it is
        validated or rejected. Watch progress on the invoice page.
      </p>
    </div>
  );
}
