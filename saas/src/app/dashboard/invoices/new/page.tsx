import { auth } from '@clerk/nextjs/server';
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '@/db';
import { companies } from '@/db/schema';
import { InvoiceForm } from '@/components/invoices/InvoiceForm';

export default async function NewInvoicePage() {
  const { userId } = await auth();
  if (!userId) return null;

  const rows = await db.select().from(companies).where(eq(companies.userId, userId));

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">New invoice</h1>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-600">
          Add a company first —{' '}
          <Link href="/dashboard/companies" className="underline">
            Companies
          </Link>
          .
        </p>
      ) : (
        <InvoiceForm
          companies={rows.map((c) => ({ id: c.id, name: c.name, cif: c.cif, verified: Boolean(c.spvVerifiedAt) }))}
        />
      )}
    </div>
  );
}
