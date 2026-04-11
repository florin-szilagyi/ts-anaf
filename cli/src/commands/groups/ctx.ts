import type { Command } from 'commander';
import type { CommandDeps } from '../buildProgram';
import { CliError } from '../../output/errors';
import { renderSuccess } from '../../output';
import type { Context, Environment } from '../../state';

interface CtxAddOptions {
  name?: string;
  cui?: string;
  clientId?: string;
  redirectUri?: string;
  env?: string;
}

interface CtxListItem {
  name: string;
  companyCui: string;
  environment: Environment;
  isCurrent: boolean;
}

interface CtxListData {
  current: string | undefined;
  contexts: CtxListItem[];
}

export async function ctxLs(deps: CommandDeps): Promise<void> {
  const contexts = deps.services.contextService.list();
  let current: string | undefined;
  try {
    current = deps.services.contextService.resolve().name;
  } catch {
    current = undefined;
  }
  const data: CtxListData = {
    current,
    contexts: contexts.map((c) => ({
      name: c.name,
      companyCui: c.companyCui,
      environment: c.environment,
      isCurrent: c.name === current,
    })),
  };
  renderSuccess(deps.output, data, (d) => {
    if (d.contexts.length === 0) return '(no contexts)';
    return d.contexts.map((c) => `${c.isCurrent ? '*' : ' '} ${c.name}\t${c.environment}\t${c.companyCui}`).join('\n');
  });
}

export async function ctxCurrent(deps: CommandDeps): Promise<void> {
  const ctx = deps.services.contextService.resolve();
  renderSuccess(
    deps.output,
    { name: ctx.name, companyCui: ctx.companyCui, environment: ctx.environment },
    (d) => d.name
  );
}

export async function ctxUse(deps: CommandDeps, name: string): Promise<void> {
  deps.services.contextService.setCurrent(name);
  renderSuccess(deps.output, { current: name }, (d) => `current context: ${d.current}`);
}

export async function ctxAdd(deps: CommandDeps, opts: CtxAddOptions): Promise<void> {
  const required: Array<keyof CtxAddOptions> = ['name', 'cui', 'clientId', 'redirectUri'];
  const missing = required.filter((k) => !opts[k]);
  if (missing.length > 0) {
    throw new CliError({
      code: 'BAD_USAGE',
      message: `ctx add: missing required options: ${missing.map((k) => `--${kebab(k)}`).join(', ')}`,
      category: 'user_input',
      details: { missing },
    });
  }
  const env = opts.env ?? 'prod';
  if (env !== 'test' && env !== 'prod') {
    throw new CliError({
      code: 'BAD_USAGE',
      message: `ctx add: --env must be 'test' or 'prod' (got "${env}")`,
      category: 'user_input',
      details: { env },
    });
  }
  const ctx: Context = {
    name: opts.name!,
    companyCui: opts.cui!,
    environment: env as Environment,
    auth: {
      clientId: opts.clientId!,
      redirectUri: opts.redirectUri!,
    },
  };
  const created = deps.services.contextService.add(ctx);
  renderSuccess(
    deps.output,
    { name: created.name, environment: created.environment, companyCui: created.companyCui },
    (d) => `added context: ${d.name} (${d.environment}, ${d.companyCui})`
  );
}

export async function ctxRm(deps: CommandDeps, name: string): Promise<void> {
  deps.services.contextService.remove(name);
  renderSuccess(deps.output, { removed: name }, (d) => `removed: ${d.removed}`);
}

export async function ctxRename(deps: CommandDeps, oldName: string, newName: string): Promise<void> {
  const renamed = deps.services.contextService.rename(oldName, newName);
  renderSuccess(deps.output, { from: oldName, to: renamed.name }, (d) => `renamed: ${d.from} \u2192 ${d.to}`);
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

export function registerCtx(parent: Command, deps: CommandDeps): void {
  const ctx = parent.command('ctx').description('Manage company contexts');

  ctx
    .command('ls')
    .description('List all configured contexts')
    .action(() => ctxLs(deps));

  ctx
    .command('current')
    .description('Print the current context')
    .action(() => ctxCurrent(deps));

  ctx
    .command('use <name>')
    .description('Set the current context')
    .action((name: string) => ctxUse(deps, name));

  ctx
    .command('add')
    .description('Add a new context')
    .option('--name <name>', 'context name')
    .option('--cui <cui>', 'company VAT number (CUI)')
    .option('--client-id <id>', 'OAuth client id')
    .option('--redirect-uri <uri>', 'OAuth redirect uri')
    .option('--env <env>', 'environment: test|prod', 'prod')
    .action((opts: CtxAddOptions) => ctxAdd(deps, opts));

  ctx
    .command('rm <name>')
    .description('Remove a context (and its token file)')
    .action((name: string) => ctxRm(deps, name));

  ctx
    .command('rename <oldName> <newName>')
    .description('Rename a context')
    .action((oldName: string, newName: string) => ctxRename(deps, oldName, newName));
}
