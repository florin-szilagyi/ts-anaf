import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import type {
  CompanyResource,
  CreateInvoiceInput,
  CreateInvoiceResult,
  InvoiceResource,
  ListInvoicesFilters,
  ListInvoicesResult,
} from '@florinszilagyi/fastbill-sdk';
import { buildProgram } from '../../../src/commands/buildProgram';
import { makeOutputContext } from '../../../src/output';
import {
  fastbillCompanies,
  fastbillCreate,
  fastbillDownload,
  fastbillGet,
  fastbillLs,
  fastbillSetKey,
} from '../../../src/commands/groups/fastbill';
import type { FastbillService } from '../../../src/services';

describe('fastbill group registration', () => {
  it('registers auth, companies, invoices, download, validate', () => {
    const program = buildProgram({
      output: makeOutputContext({ format: 'text' }),
      services: {} as never,
    });
    const fb = program.commands.find((c) => c.name() === 'fastbill')!;
    expect(fb).toBeDefined();
    expect(fb.commands.map((c) => c.name()).sort()).toEqual(['auth', 'companies', 'download', 'invoices', 'validate']);
    const invoices = fb.commands.find((c) => c.name() === 'invoices')!;
    expect(invoices.commands.map((c) => c.name()).sort()).toEqual(['create', 'get', 'ls', 'wait']);
  });
});

class Cap extends Writable {
  buf = '';
  _write(c: Buffer, _e: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.buf += c.toString('utf8');
    cb();
  }
}

const INVOICE: InvoiceResource = {
  id: 'inv-1',
  companyId: 'comp-1',
  direction: 'outbound',
  mode: 'test',
  status: 'queued',
  invoiceNumber: 'FB-1',
  issueDate: '2026-07-01',
  dueDate: null,
  currency: 'RON',
  totalAmount: '238.00',
  taxAmount: '38.00',
  counterpartyCif: '99999999',
  counterpartyName: 'Client SRL',
  anafUploadIndex: null,
  anafDownloadId: null,
  error: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  finalizedAt: null,
  links: { self: 'http://x/api/v1/invoices/inv-1' },
};

class StubFastbill {
  storedKey?: { apiKey: string; baseUrl?: string };
  createCalls: Array<{ input: CreateInvoiceInput; idempotencyKey?: string }> = [];
  lsFilters: ListInvoicesFilters | undefined;
  createResult: CreateInvoiceResult = { id: 'inv-1', status: 'queued', replayed: false };
  waitResult: InvoiceResource = { ...INVOICE, status: 'validated' };
  listResult: ListInvoicesResult = { invoices: [INVOICE], nextCursor: 'cur-2' };

  setKey(apiKey: string, baseUrl?: string): { mode: 'test' | 'live' } {
    this.storedKey = { apiKey, baseUrl };
    return { mode: apiKey.startsWith('sk_live_') ? 'live' : 'test' };
  }

  async call<T>(_opts: unknown, fn: (client: unknown) => Promise<T>): Promise<T> {
    const client = {
      mode: 'test' as const,
      createInvoice: async (input: CreateInvoiceInput, opts?: { idempotencyKey?: string }) => {
        this.createCalls.push({ input, idempotencyKey: opts?.idempotencyKey });
        return this.createResult;
      },
      getInvoice: async () => INVOICE,
      waitForInvoice: async () => this.waitResult,
      listInvoices: async (filters?: ListInvoicesFilters) => {
        this.lsFilters = filters;
        return this.listResult;
      },
      listCompanies: async (): Promise<CompanyResource[]> => [
        {
          id: 'comp-1',
          cif: '11111111',
          name: 'Acme SRL',
          vatPayer: true,
          spvVerified: true,
          archiveEnabled: true,
          lastSyncAt: null,
        },
      ],
      validateInvoice: async () => ({ valid: true, details: null, info: null }),
      downloadXml: async () => Buffer.from('<xml/>'),
      downloadZip: async () => Buffer.from([0x50, 0x4b]),
      downloadPdf: async () => Buffer.from('%PDF'),
    };
    return fn(client);
  }
}

function harness(stub: StubFastbill) {
  const out = new Cap();
  const err = new Cap();
  const json = makeOutputContext({ format: 'json', streams: { stdout: out, stderr: err } });
  const deps = {
    output: json,
    services: { fastbillService: stub as unknown as FastbillService } as never,
    paths: {} as never,
  };
  return { deps, out, err };
}

describe('fastbill handlers', () => {
  it('set-key stores the key', async () => {
    const stub = new StubFastbill();
    const { deps, out } = harness(stub);
    await fastbillSetKey(deps, { apiKey: 'sk_live_x' });
    expect(stub.storedKey?.apiKey).toBe('sk_live_x');
    expect(JSON.parse(out.buf)).toMatchObject({ success: true, data: { mode: 'live' } });
  });

  it('companies renders the list', async () => {
    const stub = new StubFastbill();
    const { deps, out } = harness(stub);
    await fastbillCompanies(deps, {});
    const body = JSON.parse(out.buf);
    expect(body.data.companies[0]).toMatchObject({ cif: '11111111', spvVerified: true });
  });

  it('create passes idempotency key and reports queued', async () => {
    const stub = new StubFastbill();
    const { deps, out } = harness(stub);
    await fastbillCreate(deps, {
      companyId: 'a0000000-0000-4000-8000-000000000001',
      number: 'FB-1',
      issueDate: '2026-07-01',
      customerCui: 'RO99999999',
      line: ['Consulting|2|100|19'],
      idempotencyKey: 'job-1',
    });
    expect(stub.createCalls[0].idempotencyKey).toBe('job-1');
    expect(stub.createCalls[0].input.lines).toEqual([
      { description: 'Consulting', quantity: 2, unitPrice: 100, taxPercent: 19 },
    ]);
    expect(JSON.parse(out.buf).data).toMatchObject({ id: 'inv-1', status: 'queued' });
  });

  it('create --wait renders the terminal invoice', async () => {
    const stub = new StubFastbill();
    const { deps, out } = harness(stub);
    await fastbillCreate(deps, {
      companyId: 'a0000000-0000-4000-8000-000000000001',
      number: 'FB-1',
      issueDate: '2026-07-01',
      customerCui: '99999999',
      line: ['x|1|1|0'],
      wait: true,
    });
    expect(JSON.parse(out.buf).data).toMatchObject({ id: 'inv-1', status: 'validated' });
  });

  it('create without required flags fails with BAD_USAGE', async () => {
    const stub = new StubFastbill();
    const { deps } = harness(stub);
    await expect(fastbillCreate(deps, { number: 'FB-1' })).rejects.toMatchObject({ code: 'BAD_USAGE' });
  });

  it('get renders an invoice', async () => {
    const stub = new StubFastbill();
    const { deps, out } = harness(stub);
    await fastbillGet(deps, 'inv-1', {});
    expect(JSON.parse(out.buf).data).toMatchObject({ id: 'inv-1', invoiceNumber: 'FB-1' });
  });

  it('ls forwards filters and surfaces the cursor', async () => {
    const stub = new StubFastbill();
    const { deps, out } = harness(stub);
    await fastbillLs(deps, { status: 'queued', limit: '2', cursor: 'cur-1' });
    expect(stub.lsFilters).toMatchObject({ status: 'queued', limit: 2, cursor: 'cur-1' });
    expect(JSON.parse(out.buf).data.nextCursor).toBe('cur-2');
  });

  it('download writes bytes to a file', async () => {
    const stub = new StubFastbill();
    const { deps } = harness(stub);
    const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fb-dl-')), 'doc.zip');
    await fastbillDownload(deps, 'inv-1', { kind: 'zip', out: target });
    expect([...fs.readFileSync(target)]).toEqual([0x50, 0x4b]);
  });

  it('download rejects unknown kinds', async () => {
    const stub = new StubFastbill();
    const { deps } = harness(stub);
    await expect(fastbillDownload(deps, 'inv-1', { kind: 'docx' })).rejects.toMatchObject({ code: 'BAD_USAGE' });
  });
});
