import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LookupService } from '../../src/services/lookupService';
import { getXdgPaths } from '../../src/state/paths';
import { CliError } from '../../src/output/errors';
import type { AnafCompanyData, AnafCompanyResult, AnafAsyncCompanyResult } from '@florinszilagyi/anaf-ts-sdk';

function freshPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-lookup-'));
  return getXdgPaths({
    configHome: path.join(dir, 'config'),
    dataHome: path.join(dir, 'data'),
    cacheHome: path.join(dir, 'cache'),
  });
}

const fakeCompany: AnafCompanyData = {
  vatCode: '12345678',
  name: 'Acme SRL',
  registrationNumber: 'J40/123/2010',
  address: 'Bucuresti, Sector 1, Strada X nr 1',
  postalCode: '012345',
  contactPhone: '021-1234567',
  scpTva: true,
};

class FakeClient {
  batchCalls = 0;
  asyncCalls = 0;
  validateCalls = 0;
  shouldFail = false;
  notFound = false;

  async batchGetCompanyData(cuis: string[]): Promise<AnafCompanyResult> {
    this.batchCalls += 1;
    if (this.shouldFail) {
      return { success: false, error: 'simulated network failure' };
    }
    if (this.notFound) {
      return { success: false, error: 'Companies not found for the provided VAT codes.' };
    }
    return {
      success: true,
      data: cuis.map((c) => ({ ...fakeCompany, vatCode: c.replace(/^RO/i, '') })),
    };
  }

  async getCompanyDataAsync(cui: string): Promise<AnafAsyncCompanyResult> {
    this.asyncCalls += 1;
    if (this.shouldFail) return { success: false, error: 'async failed' };
    return {
      success: true,
      data: [{ ...fakeCompany, vatCode: cui.replace(/^RO/i, '') }],
      fullDetails: [],
      notFound: [],
    };
  }

  async isValidVatCode(cui: string): Promise<boolean> {
    this.validateCalls += 1;
    return /^(RO)?\d{2,10}$/i.test(cui.trim());
  }
}

describe('LookupService.getCompany', () => {
  it('fetches via the SDK on a cache miss and writes the result', async () => {
    const paths = freshPaths();
    const client = new FakeClient();
    const svc = new LookupService({ client: client as never, paths });
    const data = await svc.getCompany('RO12345678');
    expect(data.name).toBe('Acme SRL');
    expect(client.batchCalls).toBe(1);
    expect(fs.existsSync(paths.cacheFile('12345678'))).toBe(true);
  });

  it('returns cached data on hit without re-calling the SDK', async () => {
    const paths = freshPaths();
    const client = new FakeClient();
    const svc = new LookupService({ client: client as never, paths });
    await svc.getCompany('RO12345678');
    expect(client.batchCalls).toBe(1);
    await svc.getCompany('RO12345678');
    expect(client.batchCalls).toBe(1); // still 1
  });

  it('useCache=false bypasses the cache for both read and write', async () => {
    const paths = freshPaths();
    const client = new FakeClient();
    const svc = new LookupService({ client: client as never, paths });
    await svc.getCompany('RO12345678');
    expect(fs.existsSync(paths.cacheFile('12345678'))).toBe(true);
    fs.unlinkSync(paths.cacheFile('12345678'));
    await svc.getCompany('RO12345678', { useCache: false });
    expect(client.batchCalls).toBe(2);
    expect(fs.existsSync(paths.cacheFile('12345678'))).toBe(false); // not written
  });

  it('refreshCache=true forces a fresh fetch and overwrites the cache', async () => {
    const paths = freshPaths();
    const client = new FakeClient();
    const svc = new LookupService({ client: client as never, paths });
    await svc.getCompany('RO12345678');
    const cachedAt1 = JSON.parse(fs.readFileSync(paths.cacheFile('12345678'), 'utf8')).fetchedAt;
    await new Promise((r) => setTimeout(r, 10));
    await svc.getCompany('RO12345678', { refreshCache: true });
    expect(client.batchCalls).toBe(2);
    const cachedAt2 = JSON.parse(fs.readFileSync(paths.cacheFile('12345678'), 'utf8')).fetchedAt;
    expect(cachedAt2 > cachedAt1).toBe(true);
  });

  it('throws CliError(anaf_api, LOOKUP_FAILED) when the SDK reports failure', async () => {
    const client = new FakeClient();
    client.shouldFail = true;
    const svc = new LookupService({ client: client as never, paths: freshPaths() });
    let err: unknown;
    try {
      await svc.getCompany('RO12345678');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).category).toBe('anaf_api');
    expect((err as CliError).code).toBe('LOOKUP_FAILED');
  });

  it('throws CliError(anaf_api, LOOKUP_NOT_FOUND) when the company does not exist', async () => {
    const client = new FakeClient();
    client.notFound = true;
    const svc = new LookupService({ client: client as never, paths: freshPaths() });
    let err: unknown;
    try {
      await svc.getCompany('RO12345678');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('LOOKUP_NOT_FOUND');
  });

  it('treats a corrupt cache file as a miss and deletes it', async () => {
    const paths = freshPaths();
    const client = new FakeClient();
    fs.mkdirSync(paths.companyCacheDir, { recursive: true });
    fs.writeFileSync(paths.cacheFile('12345678'), 'not json');
    const svc = new LookupService({ client: client as never, paths });
    const data = await svc.getCompany('RO12345678');
    expect(data.name).toBe('Acme SRL');
    expect(client.batchCalls).toBe(1);
    // file should now contain valid JSON (re-fetched + written)
    const re = JSON.parse(fs.readFileSync(paths.cacheFile('12345678'), 'utf8'));
    expect(re.data.name).toBe('Acme SRL');
  });
});

describe('LookupService.batchGetCompanies', () => {
  it('returns one result per requested CUI', async () => {
    const svc = new LookupService({ client: new FakeClient() as never, paths: freshPaths() });
    const results = await svc.batchGetCompanies(['RO12345678', 'RO87654321']);
    expect(results).toHaveLength(2);
    expect(results[0].vatCode).toBe('12345678');
    expect(results[1].vatCode).toBe('87654321');
  });

  it('serves from cache when all CUIs are cached and only fetches misses', async () => {
    const paths = freshPaths();
    const client = new FakeClient();
    const svc = new LookupService({ client: client as never, paths });
    await svc.getCompany('RO12345678'); // populates cache for one
    expect(client.batchCalls).toBe(1);
    await svc.batchGetCompanies(['RO12345678', 'RO87654321']);
    expect(client.batchCalls).toBe(2); // second call only for the missing one
  });
});

describe('LookupService.getCompanyAsync', () => {
  it('always bypasses the cache', async () => {
    const paths = freshPaths();
    const client = new FakeClient();
    const svc = new LookupService({ client: client as never, paths });
    await svc.getCompanyAsync('RO12345678');
    await svc.getCompanyAsync('RO12345678');
    expect(client.asyncCalls).toBe(2);
    expect(fs.existsSync(paths.cacheFile('12345678'))).toBe(false);
  });
});

describe('LookupService.validateCui', () => {
  it('delegates to the SDK', async () => {
    const client = new FakeClient();
    const svc = new LookupService({ client: client as never, paths: freshPaths() });
    expect(await svc.validateCui('RO12345678')).toBe(true);
    expect(await svc.validateCui('not-a-cui')).toBe(false);
    expect(client.validateCalls).toBe(2);
  });
});

describe('LookupService.invalidate', () => {
  it('removes a cached entry', async () => {
    const paths = freshPaths();
    const svc = new LookupService({ client: new FakeClient() as never, paths });
    await svc.getCompany('RO12345678');
    expect(fs.existsSync(paths.cacheFile('12345678'))).toBe(true);
    svc.invalidate('RO12345678');
    expect(fs.existsSync(paths.cacheFile('12345678'))).toBe(false);
  });

  it('is a no-op if the entry does not exist', () => {
    const svc = new LookupService({ client: new FakeClient() as never, paths: freshPaths() });
    expect(() => svc.invalidate('RO99999999')).not.toThrow();
  });
});
