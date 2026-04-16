import path from 'node:path';
import { execFile } from 'node:child_process';
import type { Command } from 'commander';
import type { CommandDeps } from '../buildProgram';
import { CliError } from '../../output/errors';
import { renderSuccess } from '../../output';
import { kv, table } from '../../output/format';
import { waitForCallback } from '../../services/callbackServer';

interface LoginOpts {
  scope?: string;
  noCallbackServer?: boolean;
  clientSecretStdin?: boolean;
}

interface RefreshOpts {
  clientSecretStdin?: boolean;
}

function readSecretFromEnv(): string | undefined {
  const v = process.env.ANAF_CLIENT_SECRET;
  return v && v.length > 0 ? v : undefined;
}

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

/** Extract the port number from a localhost redirect URI like https://localhost:9002/callback */
function portFromUri(uri: string): number {
  const url = new URL(uri); // always valid — schema enforces https://localhost
  if (!url.port) {
    throw new CliError({
      code: 'BAD_USAGE',
      message: `redirectUri "${uri}" has no port. ANAF requires an explicit port, e.g. https://localhost:9002/callback`,
      category: 'user_input',
    });
  }
  return parseInt(url.port, 10);
}

/** Open a URL in the default browser (best-effort, no throw). */
function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  execFile(cmd, [url], () => {
    /* ignore errors — user can open manually */
  });
}

export async function authLogin(deps: CommandDeps, cui: string, opts: LoginOpts): Promise<void> {
  // 1. Read credential (throw if missing)
  const credential = deps.services.credentialService.get();

  // 2. Look up company from ANAF
  const { stderr } = deps.output.streams;
  stderr.write(`Looking up company ${cui} from ANAF...\n`);
  const companyData = await deps.services.lookupService.getCompany(cui);
  const company = {
    cui: companyData.vatCode ?? cui.replace(/^RO/i, ''),
    name: companyData.name,
    registrationNumber: companyData.registrationNumber ?? undefined,
    address: companyData.address ?? undefined,
  };

  // 3. Save company
  deps.services.companyService.add(company);
  stderr.write(`Registered company: ${company.name} (${company.cui})\n`);

  // 4. Build authorization URL
  const result = deps.services.authService.buildAuthorizationUrl(opts.scope);

  if (opts.noCallbackServer) {
    stderr.write(`Open this URL in a browser:\n  ${result.url}\n\n`);
    stderr.write(`Then paste the authorization code with: anaf-cli auth code --code <pasted-code>\n`);
    // Still set the active CUI even in manual flow
    deps.services.configStore.setActiveCui(company.cui);
    renderSuccess(
      deps.output,
      { cui: company.cui, name: company.name, url: result.url },
      (d) => `login url ready for ${d.name} (${d.cui})`
    );
    return;
  }

  const secretStdin = opts.clientSecretStdin ? await readStdin() : undefined;
  const secret = { stdin: secretStdin, env: readSecretFromEnv() };

  const port = portFromUri(credential.redirectUri);
  const tlsDir = path.join(deps.paths.appDataDir, 'tls');

  stderr.write(`Opening browser for ANAF authentication...\n`);
  stderr.write(`If you see a certificate warning, click "Advanced" > "Proceed" to trust it.\n\n`);
  openBrowser(`https://localhost:${port}/`);

  let code: string;
  try {
    const cb = await waitForCallback({ port, tlsDir, stderr, authUrl: result.url });
    code = cb.code;
  } catch (err) {
    stderr.write(`\nCallback server unavailable: ${(err as Error).message}\n`);
    stderr.write(`Open this URL in a browser:\n  ${result.url}\n\n`);
    stderr.write(`Then paste the code with: anaf-cli auth code --code <pasted-code>\n`);
    deps.services.configStore.setActiveCui(company.cui);
    renderSuccess(
      deps.output,
      { cui: company.cui, name: company.name, url: result.url },
      (d) => `login url ready for ${d.name} (${d.cui})`
    );
    return;
  }

  stderr.write(`Authorization code received. Exchanging for tokens...\n`);

  // 5. Exchange code for token
  const record = await deps.services.authService.exchangeCode({
    code,
    secret,
  });

  // 6. Set as active CUI
  deps.services.configStore.setActiveCui(company.cui);

  // 7. Print result
  renderSuccess(
    deps.output,
    { cui: company.cui, name: company.name, expiresAt: record.expiresAt },
    (d) => `Authenticated as ${d.name} (${d.cui})`
  );
}

export async function authUse(deps: CommandDeps, cui: string): Promise<void> {
  // Validate company exists
  const company = deps.services.companyService.get(cui);
  deps.services.configStore.setActiveCui(cui);
  renderSuccess(deps.output, { cui: company.cui, name: company.name }, (d) => `Active: ${d.name} (${d.cui})`);
}

export async function authWhoami(deps: CommandDeps): Promise<void> {
  const result = deps.services.authService.whoami();
  if (!result.company) {
    renderSuccess(
      deps.output,
      { tokenStatus: result.tokenStatus, env: result.env },
      () => 'No active company. Run `anaf-cli auth login <CUI>` first.'
    );
    return;
  }
  renderSuccess(
    deps.output,
    {
      cui: result.company.cui,
      name: result.company.name,
      env: result.env,
      tokenStatus: result.tokenStatus,
      expiresAt: result.expiresAt,
      obtainedAt: result.obtainedAt,
    },
    (d) =>
      kv([
        ['Company', `${d.name} (${d.cui})`],
        ['Environment', d.env],
        ['Token', d.tokenStatus],
        ['Expires', d.expiresAt ?? undefined],
        ['Obtained', d.obtainedAt ?? undefined],
      ])
  );
}

export async function authLs(deps: CommandDeps): Promise<void> {
  const companies = deps.services.companyService.list();
  const activeCui = deps.services.configStore.getActiveCui();
  const env = deps.services.configStore.getEnv();
  const data = {
    activeCui,
    env,
    companies: companies.map((c) => ({
      cui: c.cui,
      name: c.name,
      isActive: c.cui === activeCui,
    })),
  };
  renderSuccess(deps.output, data, (d) => {
    if (d.companies.length === 0) return '(no registered companies)';
    return table(
      [
        { key: 'active', header: ' ' },
        { key: 'cui', header: 'CUI' },
        { key: 'name', header: 'Name' },
      ],
      d.companies.map((c) => ({ active: c.isActive ? '*' : '', cui: c.cui, name: c.name }))
    );
  });
}

export async function authRm(deps: CommandDeps, cui: string): Promise<void> {
  deps.services.companyService.remove(cui);
  // If the removed company was active, clear the active CUI
  const activeCui = deps.services.configStore.getActiveCui();
  if (activeCui === cui) {
    deps.services.configStore.setActiveCui(undefined);
  }
  renderSuccess(deps.output, { removed: cui }, (d) => `removed: ${d.removed}`);
}

export async function authLogout(deps: CommandDeps): Promise<void> {
  deps.services.authService.logout();
  renderSuccess(deps.output, { loggedOut: true }, () => 'token removed');
}

export async function authRefresh(deps: CommandDeps, opts: RefreshOpts): Promise<void> {
  const secretStdin = opts.clientSecretStdin ? await readStdin() : undefined;
  const record = await deps.services.authService.refresh({
    secret: { stdin: secretStdin, env: readSecretFromEnv() },
  });
  renderSuccess(deps.output, { expiresAt: record.expiresAt }, (d) => `refreshed (expires ${d.expiresAt ?? '?'})`);
}

export async function authToken(deps: CommandDeps, opts: RefreshOpts): Promise<void> {
  if (opts.clientSecretStdin) {
    // refresh first, then show
    const secretStdin = await readStdin();
    await deps.services.authService.refresh({
      secret: { stdin: secretStdin, env: readSecretFromEnv() },
    });
  }

  const record = deps.services.authService.getToken();
  if (!record) {
    throw new CliError({
      code: 'NO_REFRESH_TOKEN',
      message: 'No token found. Run `anaf-cli auth login <CUI>` first.',
      category: 'auth',
    });
  }

  renderSuccess(
    deps.output,
    {
      accessToken: record.accessToken,
      refreshToken: record.refreshToken,
      expiresAt: record.expiresAt,
      obtainedAt: record.obtainedAt,
    },
    (d) =>
      [
        `accessToken:  ${d.accessToken ?? '(none — run auth refresh)'}`,
        `refreshToken: ${d.refreshToken}`,
        `expiresAt:    ${d.expiresAt ?? '?'}`,
        `obtainedAt:   ${d.obtainedAt ?? '?'}`,
      ].join('\n')
  );
}

export function registerAuth(parent: Command, deps: CommandDeps): void {
  const auth = parent.command('auth').description('Companies and OAuth authentication');

  auth
    .command('login <cui>')
    .description('Look up a company from ANAF, authenticate, and set as active')
    .option('--scope <scope>', 'OAuth scope override')
    .option('--no-callback-server', 'skip local server, print URL for manual flow')
    .option('--client-secret-stdin', 'read the client secret from stdin')
    .action((cui: string, opts: LoginOpts) => authLogin(deps, cui, opts));

  auth
    .command('use <cui>')
    .description('Switch the active company')
    .action((cui: string) => authUse(deps, cui));

  auth
    .command('whoami')
    .description('Show active company + token status')
    .action(() => authWhoami(deps));

  auth
    .command('ls')
    .description('List all registered companies')
    .action(() => authLs(deps));

  auth
    .command('rm <cui>')
    .description('Remove a registered company')
    .action((cui: string) => authRm(deps, cui));

  auth
    .command('logout')
    .description('Discard tokens')
    .action(() => authLogout(deps));

  auth
    .command('refresh')
    .description('Force-refresh the access token')
    .option('--client-secret-stdin', 'read the client secret from stdin')
    .action((opts: RefreshOpts) => authRefresh(deps, opts));

  auth
    .command('token')
    .description('Print the stored access and refresh tokens (for debugging)')
    .option('--client-secret-stdin', 'refresh first, then print')
    .action((opts: RefreshOpts) => authToken(deps, opts));
}
