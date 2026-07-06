import { execSync } from 'node:child_process';
import path from 'node:path';
import type { Server } from 'node:http';
import { DATABASE_URL, HAS_CLERK, MANAGES_PG } from './support/env';
import { startInngestStub } from './support/inngestStub';
import { startPostgres, stopPostgres } from './support/postgres';
import { seed } from './support/seed';

/**
 * E2E bootstrap: scratch Postgres (unless E2E_DATABASE_URL points at one),
 * drizzle migrations, deterministic seed, Inngest event sink, optional Clerk
 * testing-token setup. Returns the teardown.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  if (MANAGES_PG) {
    startPostgres();
  }

  execSync('pnpm exec drizzle-kit migrate', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL },
    stdio: 'pipe',
  });

  await seed();
  const stub: Server = await startInngestStub();

  if (HAS_CLERK) {
    const { clerkSetup } = await import('@clerk/testing/playwright');
    await clerkSetup();
  }

  return async () => {
    await new Promise<void>((resolve) => stub.close(() => resolve()));
    if (MANAGES_PG) {
      stopPostgres();
    }
  };
}
