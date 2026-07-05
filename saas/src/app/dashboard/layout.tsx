import { UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import type { ReactNode } from 'react';

const NAV: Array<{ href: string; label: string }> = [
  { href: '/dashboard', label: 'Overview' },
  { href: '/dashboard/companies', label: 'Companies' },
  { href: '/dashboard/invoices', label: 'Invoices' },
  { href: '/dashboard/api-keys', label: 'API keys' },
  { href: '/dashboard/archive', label: 'Archive' },
  { href: '/dashboard/settings', label: 'Settings' },
];

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 border-r border-zinc-200 bg-white p-4">
        <Link href="/" className="block px-2 text-lg font-bold tracking-tight">
          fastbill
        </Link>
        <nav className="mt-6 space-y-1">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-lg px-2 py-1.5 text-sm text-zinc-700 hover:bg-zinc-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-end border-b border-zinc-200 bg-white px-6 py-3">
          <UserButton afterSignOutUrl="/" />
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
