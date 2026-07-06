import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { BASE_URL, SEED } from './support/env';

/**
 * End-to-end smoke of the whole automation chain:
 *   anaf-cli fastbill … → @florinszilagyi/fastbill-sdk → /api/v1 → Postgres.
 * Runs the built CLI bundle against the e2e server with a seeded sk_test key.
 * Skips when the bundle hasn't been built (pnpm run build:cli).
 */

const CLI_BUNDLE = path.resolve(__dirname, '../../cli/dist/bin/anaf-cli.cjs');

function cli(
  args: string[],
  extraEnv: Record<string, string> = {}
): { stdout: string; parsed: { success: boolean; data?: unknown; error?: unknown } } {
  const stdout = execFileSync(process.execPath, [CLI_BUNDLE, ...args, '--format', 'json'], {
    env: {
      ...process.env,
      FASTBILL_API_KEY: SEED.skTest,
      FASTBILL_BASE_URL: BASE_URL,
      ...extraEnv,
    },
    encoding: 'utf8',
  });
  return { stdout, parsed: JSON.parse(stdout) };
}

test.describe('CLI smoke (anaf-cli fastbill → API)', () => {
  test.skip(!existsSync(CLI_BUNDLE), 'CLI bundle not built — run `pnpm run build:cli` first');

  test('auth status reports mode and companies', () => {
    const { parsed } = cli(['fastbill', 'auth', 'status']);
    expect(parsed).toMatchObject({ success: true, data: { mode: 'test', companies: 2 } });
  });

  test('companies lists the seeded fixtures', () => {
    const { parsed } = cli(['fastbill', 'companies']);
    const companies = (parsed.data as { companies: Array<{ cif: string; spvVerified: boolean }> }).companies;
    expect(companies.map((c) => c.cif).sort()).toEqual(['11111111', '22222222']);
  });

  test('invoices create → get round-trips through the API', () => {
    const { parsed: created } = cli([
      'fastbill',
      'invoices',
      'create',
      '--company-id',
      SEED.verifiedCompanyId,
      '--number',
      'E2E-CLI-1',
      '--issue-date',
      '2026-07-01',
      '--customer-cui',
      'RO99999999',
      '--line',
      'CLI smoke|2|100|19',
      '--idempotency-key',
      'e2e-cli-1',
    ]);
    const data = created.data as { id: string; status: string };
    expect(data.status).toBe('queued');

    const { parsed: fetched } = cli(['fastbill', 'invoices', 'get', data.id]);
    expect(fetched.data).toMatchObject({ id: data.id, invoiceNumber: 'E2E-CLI-1', status: 'queued', mode: 'test' });

    // idempotent replay returns the same invoice
    const { parsed: replayed } = cli([
      'fastbill',
      'invoices',
      'create',
      '--company-id',
      SEED.verifiedCompanyId,
      '--number',
      'E2E-CLI-1',
      '--issue-date',
      '2026-07-01',
      '--customer-cui',
      'RO99999999',
      '--line',
      'CLI smoke|2|100|19',
      '--idempotency-key',
      'e2e-cli-1',
    ]);
    expect((replayed.data as { id: string; replayed: boolean }).id).toBe(data.id);
    expect((replayed.data as { replayed: boolean }).replayed).toBe(true);
  });

  test('run -f executes a FastbillInvoice manifest', () => {
    const manifest = `apiVersion: anaf-cli/v1
kind: FastbillInvoice
spec:
  companyId: ${SEED.verifiedCompanyId}
  invoiceNumber: E2E-CLI-MANIFEST-1
  issueDate: "2026-07-02"
  customerCui: RO99999999
  lines:
    - "Manifest smoke|1|50|19"
  idempotencyKey: e2e-cli-manifest-1
`;
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'fb-manifest-')), 'job.yaml');
    writeFileSync(file, manifest);
    const { parsed } = cli(['run', '-f', file]);
    expect(parsed.success).toBe(true);
    expect((parsed.data as { status: string }).status).toBe('queued');
  });

  test('invoices ls filters by status', () => {
    const { parsed } = cli(['fastbill', 'invoices', 'ls', '--status', 'queued', '--limit', '5']);
    const data = parsed.data as { invoices: Array<{ status: string }> };
    expect(data.invoices.length).toBeGreaterThan(0);
    for (const inv of data.invoices) expect(inv.status).toBe('queued');
  });

  test('schema print emits the FastbillInvoice JSON schema (no server needed)', () => {
    const stdout = execFileSync(process.execPath, [CLI_BUNDLE, 'schema', 'print', 'FastbillInvoice'], {
      encoding: 'utf8',
    });
    const schema = JSON.parse(stdout);
    expect(schema.properties.kind.const).toBe('FastbillInvoice');
  });
});
