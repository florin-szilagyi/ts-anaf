import { Writable } from 'node:stream';
import { parse as parseYaml } from 'yaml';
import { buildProgram } from '../../../src/commands/buildProgram';
import { LookupService } from '../../../src/services';
import { CliError } from '../../../src/output/errors';
import { makeOutputContext } from '../../../src/output';
import { lookupCompany, lookupCompanyAsync, lookupValidateCui } from '../../../src/commands/groups/lookup';
import type { AnafCompanyData } from '@florinszilagyi/anaf-ts-sdk';

describe('lookup group', () => {
  it('registers company, company-async, validate-cui', () => {
    const program = buildProgram({
      output: makeOutputContext({ format: 'text' }),
      services: {} as never,
    });
    const l = program.commands.find((c) => c.name() === 'lookup')!;
    expect(l.commands.map((c) => c.name()).sort()).toEqual(['company', 'company-async', 'validate-cui']);
  });
});

class Cap extends Writable {
  buf = '';
  _write(c: Buffer, _e: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.buf += c.toString('utf8');
    cb();
  }
}

const fakeCompany = (cui: string, name = 'Acme SRL'): AnafCompanyData => ({
  vatCode: cui,
  name,
  registrationNumber: 'J40/1/2020',
  address: 'Bucuresti, Sector 1',
  postalCode: '012345',
  contactPhone: '021-1',
  scpTva: true,
});

class StubLookupService {
  batchResult: AnafCompanyData[] | Error = [];
  batchCalls: Array<{ cuis: readonly string[]; opts?: { useCache?: boolean; refreshCache?: boolean } }> = [];
  asyncResult: AnafCompanyData | Error = fakeCompany('12345678');
  validResult = true;
  async batchGetCompanies(
    cuis: readonly string[],
    opts?: { useCache?: boolean; refreshCache?: boolean }
  ): Promise<AnafCompanyData[]> {
    this.batchCalls.push({ cuis, opts });
    if (this.batchResult instanceof Error) throw this.batchResult;
    return this.batchResult;
  }
  async getCompanyAsync(_cui: string): Promise<AnafCompanyData> {
    if (this.asyncResult instanceof Error) throw this.asyncResult;
    return this.asyncResult;
  }
  async validateCui(_cui: string): Promise<boolean> {
    return this.validResult;
  }
}

function harness() {
  const stdout = new Cap();
  const stderr = new Cap();
  const lookupService = new StubLookupService();
  const text = makeOutputContext({ format: 'text', streams: { stdout, stderr } });
  const json = makeOutputContext({ format: 'json', streams: { stdout, stderr } });
  const yaml = makeOutputContext({ format: 'yaml', streams: { stdout, stderr } });
  const services = { lookupService: lookupService as unknown as LookupService } as never;
  return { stdout, stderr, lookupService, text, json, yaml, services };
}

describe('lookupCompany', () => {
  it('text mode prints a table with header and one row per company', async () => {
    const h = harness();
    h.lookupService.batchResult = [fakeCompany('12345678', 'Acme'), fakeCompany('87654321', 'Beta')];
    await lookupCompany({ output: h.text, services: h.services }, ['RO12345678', 'RO87654321'], {});
    const lines = h.stdout.buf.split('\n').filter(Boolean);
    expect(lines).toHaveLength(4); // header + separator + 2 rows
    expect(lines[0]).toContain('CUI');
    expect(lines[0]).toContain('Name');
    expect(lines[2]).toContain('12345678');
    expect(lines[2]).toContain('Acme');
    expect(lines[3]).toContain('87654321');
    expect(lines[3]).toContain('Beta');
  });

  it('json mode emits a companies envelope', async () => {
    const h = harness();
    h.lookupService.batchResult = [fakeCompany('12345678')];
    await lookupCompany({ output: h.json, services: h.services }, ['RO12345678'], {});
    const parsed = JSON.parse(h.stdout.buf);
    expect(parsed.success).toBe(true);
    expect(parsed.data.companies).toHaveLength(1);
    expect(parsed.data.companies[0].vatCode).toBe('12345678');
  });

  it('yaml mode emits structured YAML', async () => {
    const h = harness();
    h.lookupService.batchResult = [fakeCompany('12345678')];
    await lookupCompany({ output: h.yaml, services: h.services }, ['RO12345678'], {});
    const parsed = parseYaml(h.stdout.buf);
    expect(parsed.companies).toHaveLength(1);
    expect(parsed.companies[0].vatCode).toBe('12345678');
  });

  it('propagates LOOKUP_FAILED CliError from the service', async () => {
    const h = harness();
    h.lookupService.batchResult = new CliError({
      code: 'LOOKUP_FAILED',
      message: 'network down',
      category: 'anaf_api',
    });
    await expect(lookupCompany({ output: h.text, services: h.services }, ['RO12345678'], {})).rejects.toBeInstanceOf(
      CliError
    );
  });
});

describe('lookupCompanyAsync', () => {
  it('returns a single company envelope', async () => {
    const h = harness();
    h.lookupService.asyncResult = fakeCompany('12345678', 'Async Co');
    await lookupCompanyAsync({ output: h.json, services: h.services }, 'RO12345678', {});
    const parsed = JSON.parse(h.stdout.buf);
    expect(parsed.data.name).toBe('Async Co');
  });
});

describe('lookupValidateCui', () => {
  it('text mode prints "valid" and exits success when valid', async () => {
    const h = harness();
    h.lookupService.validResult = true;
    await lookupValidateCui({ output: h.text, services: h.services }, 'RO12345678');
    expect(h.stdout.buf.trim()).toBe('valid');
  });

  it('throws CliError(user_input, INVALID_CUI) when invalid', async () => {
    const h = harness();
    h.lookupService.validResult = false;
    let err: unknown;
    try {
      await lookupValidateCui({ output: h.text, services: h.services }, 'not-a-cui');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).category).toBe('user_input');
    expect((err as CliError).code).toBe('INVALID_CUI');
  });

  it('json mode emits {cui, valid: true} on valid input', async () => {
    const h = harness();
    h.lookupService.validResult = true;
    await lookupValidateCui({ output: h.json, services: h.services }, 'RO12345678');
    const parsed = JSON.parse(h.stdout.buf);
    expect(parsed.data).toEqual({ cui: 'RO12345678', valid: true });
  });
});

describe('lookupCompany cache flag plumbing (P3.4)', () => {
  it('passes useCache:true and refreshCache:false by default', async () => {
    const h = harness();
    h.lookupService.batchResult = [fakeCompany('12345678')];
    await lookupCompany({ output: h.text, services: h.services }, ['RO12345678'], {});
    expect(h.lookupService.batchCalls).toHaveLength(1);
    expect(h.lookupService.batchCalls[0].opts).toEqual({ useCache: true, refreshCache: false });
  });

  it('passes useCache:false when --no-cache is set (cache:false in opts)', async () => {
    const h = harness();
    h.lookupService.batchResult = [fakeCompany('12345678')];
    await lookupCompany({ output: h.text, services: h.services }, ['RO12345678'], { cache: false });
    expect(h.lookupService.batchCalls[0].opts).toEqual({ useCache: false, refreshCache: false });
  });

  it('passes refreshCache:true when --refresh-cache is set', async () => {
    const h = harness();
    h.lookupService.batchResult = [fakeCompany('12345678')];
    await lookupCompany({ output: h.text, services: h.services }, ['RO12345678'], { refreshCache: true });
    expect(h.lookupService.batchCalls[0].opts).toEqual({ useCache: true, refreshCache: true });
  });
});
