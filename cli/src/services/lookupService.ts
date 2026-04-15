import fs from 'node:fs';
import { AnafDetailsClient, type AnafCompanyData, type AnafAsyncPollingConfig } from '@florinszilagyi/anaf-ts-sdk';
import { CliError } from '../output/errors';
import { defaultXdgPaths, getXdgPaths, type XdgPaths } from '../state/paths';

export interface LookupServiceOptions {
  client?: AnafDetailsClient;
  paths?: XdgPaths;
  now?: () => Date;
}

export interface CachedCompany {
  vatCode: string;
  data: AnafCompanyData;
  fetchedAt: string;
}

export interface LookupOpts {
  useCache?: boolean;
  refreshCache?: boolean;
}

function classifyLookupError(error: string): 'LOOKUP_NOT_FOUND' | 'LOOKUP_FAILED' {
  return /not found/i.test(error) ? 'LOOKUP_NOT_FOUND' : 'LOOKUP_FAILED';
}

export class LookupService {
  private readonly client: AnafDetailsClient;
  private readonly paths: XdgPaths;
  private readonly now: () => Date;

  constructor(opts: LookupServiceOptions = {}) {
    this.client = opts.client ?? new AnafDetailsClient();
    this.paths = opts.paths ?? getXdgPaths(defaultXdgPaths());
    this.now = opts.now ?? (() => new Date());
  }

  async getCompany(cui: string, opts: LookupOpts = {}): Promise<AnafCompanyData> {
    const useCache = opts.useCache !== false;
    const refresh = opts.refreshCache === true;
    const normalized = normalizeCui(cui);

    if (useCache && !refresh) {
      const cached = this.readCache(normalized);
      if (cached) return cached.data;
    }

    const result = await this.client.batchGetCompanyData([cui]);
    if (!result.success) {
      const sdkError = result.error ?? 'Unknown ANAF lookup failure';
      throw new CliError({
        code: classifyLookupError(sdkError),
        message: sdkError,
        category: 'anaf_api',
        details: { cui, sdkError },
      });
    }
    const rows = result.data ?? [];
    if (rows.length === 0) {
      throw new CliError({
        code: 'LOOKUP_NOT_FOUND',
        message: `No company data returned for ${cui}`,
        category: 'anaf_api',
        details: { cui },
      });
    }

    const data = rows[0];
    if (useCache) {
      this.writeCache(normalized, data);
    }
    return data;
  }

  async batchGetCompanies(cuis: readonly string[], opts: LookupOpts = {}): Promise<AnafCompanyData[]> {
    const useCache = opts.useCache !== false;
    const refresh = opts.refreshCache === true;

    const results = new Map<string, AnafCompanyData>();
    const missing: string[] = [];

    for (const cui of cuis) {
      const normalized = normalizeCui(cui);
      if (useCache && !refresh) {
        const cached = this.readCache(normalized);
        if (cached) {
          results.set(normalized, cached.data);
          continue;
        }
      }
      missing.push(cui);
    }

    if (missing.length > 0) {
      const fetched = await this.client.batchGetCompanyData(missing);
      if (!fetched.success) {
        const sdkError = fetched.error ?? 'Unknown ANAF lookup failure';
        throw new CliError({
          code: classifyLookupError(sdkError),
          message: sdkError,
          category: 'anaf_api',
          details: { cuis: missing, sdkError },
        });
      }
      for (const data of fetched.data ?? []) {
        const normalized = normalizeCui(data.vatCode);
        results.set(normalized, data);
        if (useCache) {
          this.writeCache(normalized, data);
        }
      }
    }

    return cuis.map((cui) => {
      const normalized = normalizeCui(cui);
      const data = results.get(normalized);
      if (!data) {
        throw new CliError({
          code: 'LOOKUP_NOT_FOUND',
          message: `No data returned for ${cui}`,
          category: 'anaf_api',
          details: { cui },
        });
      }
      return data;
    });
  }

  async getCompanyAsync(cui: string, polling?: AnafAsyncPollingConfig): Promise<AnafCompanyData> {
    const result = await this.client.getCompanyDataAsync(cui, polling);
    if (!result.success) {
      const sdkError = result.error ?? 'Unknown ANAF async lookup failure';
      throw new CliError({
        code: classifyLookupError(sdkError),
        message: sdkError,
        category: 'anaf_api',
        details: { cui, sdkError },
      });
    }
    const rows = result.data ?? [];
    if (rows.length === 0) {
      throw new CliError({
        code: 'LOOKUP_NOT_FOUND',
        message: `No company data returned for ${cui}`,
        category: 'anaf_api',
        details: { cui },
      });
    }
    return rows[0];
  }

  async validateCui(cui: string): Promise<boolean> {
    return this.client.isValidVatCode(cui);
  }

  invalidate(cui: string): void {
    const file = this.paths.cacheFile(normalizeCui(cui));
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
    }
  }

  private readCache(normalizedCui: string): CachedCompany | undefined {
    const file = this.paths.cacheFile(normalizedCui);
    if (!fs.existsSync(file)) return undefined;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(raw) as CachedCompany;
      if (!parsed || !parsed.data || !parsed.fetchedAt) {
        // malformed — delete and treat as miss
        try {
          fs.unlinkSync(file);
        } catch {
          /* ignore */
        }
        return undefined;
      }
      return parsed;
    } catch {
      // corrupt — delete and treat as miss
      try {
        fs.unlinkSync(file);
      } catch {
        /* ignore */
      }
      return undefined;
    }
  }

  private writeCache(normalizedCui: string, data: AnafCompanyData): void {
    fs.mkdirSync(this.paths.companyCacheDir, { recursive: true });
    const entry: CachedCompany = {
      vatCode: normalizedCui,
      data,
      fetchedAt: this.now().toISOString(),
    };
    fs.writeFileSync(this.paths.cacheFile(normalizedCui), JSON.stringify(entry, null, 2), 'utf8');
  }
}

function normalizeCui(cui: string): string {
  return cui.trim().toUpperCase().replace(/^RO/i, '');
}
