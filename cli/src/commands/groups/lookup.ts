import type { Command } from 'commander';
import type { CommandDeps } from '../buildProgram';
import { CliError } from '../../output/errors';
import { renderSuccess } from '../../output';

interface CompanyCmdOpts {
  cache?: boolean; // commander: --no-cache → cache: false
  refreshCache?: boolean;
}

interface CompanyAsyncOpts {
  initialDelay?: string;
  retryDelay?: string;
  maxRetries?: string;
}

function lookupOptsFrom(opts: CompanyCmdOpts): { useCache?: boolean; refreshCache?: boolean } {
  return {
    useCache: opts.cache !== false,
    refreshCache: opts.refreshCache === true,
  };
}

export async function lookupCompany(deps: CommandDeps, cuis: string[], opts: CompanyCmdOpts): Promise<void> {
  const companies = await deps.services.lookupService.batchGetCompanies(cuis, lookupOptsFrom(opts));
  renderSuccess(deps.output, { companies }, (d) =>
    d.companies.map((c) => `${c.vatCode}\t${c.name}\t${c.address ?? ''}`).join('\n')
  );
}

export async function lookupCompanyAsync(deps: CommandDeps, cui: string, opts: CompanyAsyncOpts): Promise<void> {
  const polling = {
    initialDelay: opts.initialDelay ? Number(opts.initialDelay) : undefined,
    retryDelay: opts.retryDelay ? Number(opts.retryDelay) : undefined,
    maxRetries: opts.maxRetries ? Number(opts.maxRetries) : undefined,
  };
  const company = await deps.services.lookupService.getCompanyAsync(cui, polling);
  renderSuccess(deps.output, company, (c) => `${c.vatCode}\t${c.name}`);
}

export async function lookupValidateCui(deps: CommandDeps, cui: string): Promise<void> {
  const valid = await deps.services.lookupService.validateCui(cui);
  if (!valid) {
    throw new CliError({
      code: 'INVALID_CUI',
      message: `Invalid CUI format: "${cui}"`,
      category: 'user_input',
      details: { cui, valid: false },
    });
  }
  renderSuccess(deps.output, { cui, valid: true }, () => 'valid');
}

export function registerLookup(parent: Command, deps: CommandDeps): void {
  const lookup = parent.command('lookup').description('Public ANAF company lookup');

  lookup
    .command('company <cui...>')
    .description('Sync company data lookup (one or more CUIs)')
    .option('--no-cache', 'bypass the company cache for both reads and writes')
    .option('--refresh-cache', 'force a fresh fetch and overwrite the cache')
    .action((cuis: string[], opts: CompanyCmdOpts) => lookupCompany(deps, cuis, opts));

  lookup
    .command('company-async <cui>')
    .description('Async company lookup with submit + poll')
    .option('--initial-delay <ms>', 'initial poll delay in ms')
    .option('--retry-delay <ms>', 'retry delay in ms')
    .option('--max-retries <n>', 'max poll attempts')
    .action((cui: string, opts: CompanyAsyncOpts) => lookupCompanyAsync(deps, cui, opts));

  lookup
    .command('validate-cui <cui>')
    .description('Cheap CUI format validation')
    .action((cui: string) => lookupValidateCui(deps, cui));
}
