import type { Command } from 'commander';
import type { CommandDeps } from '../buildProgram';
import { CliError } from '../../output/errors';
import { renderSuccess } from '../../output';

interface LoginOpts {
  context?: string;
  scope?: string;
}

interface CodeOpts {
  context?: string;
  code?: string;
  stdin?: boolean;
  clientSecretStdin?: boolean;
}

interface RefreshOpts {
  context?: string;
  clientSecretStdin?: boolean;
}

interface WhoamiOpts {
  context?: string;
}

interface LogoutOpts {
  context?: string;
}

function readSecretFromEnv(): string | undefined {
  const v = process.env.ANAF_CLIENT_SECRET;
  return v && v.length > 0 ? v : undefined;
}

/**
 * Read the entirety of stdin and return it trimmed. Blocks until stdin closes.
 * NEVER call this in unit tests — it will hang. Only invoked when the user
 * passes `--stdin` or `--client-secret-stdin`.
 */
async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data.trim()));
    process.stdin.on('error', reject);
  });
}

export async function authLogin(deps: CommandDeps, opts: LoginOpts): Promise<void> {
  const result = deps.services.authService.buildAuthorizationUrl(opts.context, opts.scope);
  // Print the URL to STDERR so stdout stays clean for the JSON envelope when
  // the caller passes --json. Human guidance also goes to stderr.
  deps.output.streams.stderr.write(`Open this URL in a browser:\n  ${result.url}\n\n`);
  deps.output.streams.stderr.write(`Then run: anaf-cli auth code --code <pasted-code>\n`);
  renderSuccess(
    deps.output,
    { context: result.context.name, url: result.url },
    (d) => `login url ready for context: ${d.context}`
  );
}

export async function authCode(deps: CommandDeps, opts: CodeOpts): Promise<void> {
  let code = opts.code;
  if (!code && opts.stdin) {
    code = await readStdin();
  }
  if (!code) {
    throw new CliError({
      code: 'BAD_USAGE',
      message: 'auth code: --code or --stdin is required',
      category: 'user_input',
    });
  }
  const secretStdin = opts.clientSecretStdin ? await readStdin() : undefined;
  const record = await deps.services.authService.exchangeCode({
    contextName: opts.context,
    code,
    secret: { stdin: secretStdin, env: readSecretFromEnv() },
  });
  renderSuccess(
    deps.output,
    {
      context: opts.context ?? '(current)',
      expiresAt: record.expiresAt,
    },
    (d) => `${d.context}: token persisted (expires ${d.expiresAt ?? '?'})`
  );
}

export async function authRefresh(deps: CommandDeps, opts: RefreshOpts): Promise<void> {
  const secretStdin = opts.clientSecretStdin ? await readStdin() : undefined;
  const record = await deps.services.authService.refresh({
    contextName: opts.context,
    secret: { stdin: secretStdin, env: readSecretFromEnv() },
  });
  renderSuccess(
    deps.output,
    {
      context: opts.context ?? '(current)',
      expiresAt: record.expiresAt,
    },
    (d) => `${d.context}: refreshed (expires ${d.expiresAt ?? '?'})`
  );
}

export async function authWhoami(deps: CommandDeps, opts: WhoamiOpts): Promise<void> {
  const result = deps.services.authService.whoami(opts.context);
  renderSuccess(
    deps.output,
    {
      context: result.context.name,
      tokenStatus: result.tokenStatus,
      expiresAt: result.expiresAt,
      obtainedAt: result.obtainedAt,
    },
    (d) => {
      if (d.tokenStatus === 'missing') return `${d.context}: missing`;
      return `${d.context}: ${d.tokenStatus} (expires ${d.expiresAt ?? '?'})`;
    }
  );
}

export async function authLogout(deps: CommandDeps, opts: LogoutOpts): Promise<void> {
  deps.services.authService.logout(opts.context);
  renderSuccess(
    deps.output,
    { context: opts.context ?? '(current)', loggedOut: true },
    (d) => `${d.context}: token removed`
  );
}

/**
 * Register the `auth` command group.
 *
 * NOTE: each leaf also declares `--context <name>` locally. Commander's global
 * `--context` flag (attached to the root program in P1.2) does NOT auto-merge
 * into leaf `opts()`, so we add the shadowing option on each subcommand. This
 * workaround is documented in the P1.5 plan and is stable until P3.x revisits
 * global option propagation.
 */
export function registerAuth(parent: Command, deps: CommandDeps): void {
  const auth = parent.command('auth').description('OAuth authentication against ANAF');

  auth
    .command('login')
    .description('Print the OAuth authorization URL for the active context')
    .option('--context <name>', 'context name override')
    .option('--scope <scope>', 'OAuth scope override')
    .action((opts: LoginOpts) => authLogin(deps, opts));

  auth
    .command('code')
    .description('Exchange a pasted authorization code for tokens')
    .option('--context <name>', 'context name override')
    .option('--code <code>', 'authorization code from the browser')
    .option('--stdin', 'read the authorization code from stdin')
    .option('--client-secret-stdin', 'read the client secret from stdin')
    .action((opts: CodeOpts) => authCode(deps, opts));

  auth
    .command('refresh')
    .description('Force a refresh of the active context tokens')
    .option('--context <name>', 'context name override')
    .option('--client-secret-stdin', 'read the client secret from stdin')
    .action((opts: RefreshOpts) => authRefresh(deps, opts));

  auth
    .command('whoami')
    .description('Print the active context and token freshness')
    .option('--context <name>', 'context name override')
    .action((opts: WhoamiOpts) => authWhoami(deps, opts));

  auth
    .command('logout')
    .description('Discard tokens for the active context')
    .option('--context <name>', 'context name override')
    .action((opts: LogoutOpts) => authLogout(deps, opts));
}
