import type { Command } from 'commander';
import type { CommandDeps } from '../buildProgram';
import { CliError } from '../../output/errors';
import { renderSuccess } from '../../output';
import type { Credential, Environment } from '../../state';

interface CredSetOptions {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  env?: string;
}

function maskSecret(secret: string): string {
  if (secret.length <= 8) return '***';
  return secret.slice(0, 8) + '***';
}

export async function credSet(deps: CommandDeps, opts: CredSetOptions): Promise<void> {
  const hasCredFields = opts.clientId !== undefined || opts.redirectUri !== undefined;
  const hasEnv = opts.env !== undefined;

  // If --env is passed, validate and set it
  if (hasEnv) {
    const env = opts.env as string;
    if (env !== 'test' && env !== 'prod') {
      throw new CliError({
        code: 'BAD_USAGE',
        message: `cred set: --env must be 'test' or 'prod' (got "${env}")`,
        category: 'user_input',
        details: { env },
      });
    }
    deps.services.configStore.setEnv(env as Environment);
    if (!hasCredFields) {
      renderSuccess(deps.output, { env }, (d) => `environment set to: ${d.env}`);
      return;
    }
  }

  // Credential fields path
  if (!opts.clientId || !opts.redirectUri) {
    throw new CliError({
      code: 'BAD_USAGE',
      message: 'cred set: --client-id and --redirect-uri are required',
      category: 'user_input',
    });
  }

  const cred: Credential = {
    clientId: opts.clientId,
    ...(opts.clientSecret ? { clientSecret: opts.clientSecret } : {}),
    redirectUri: opts.redirectUri,
  };
  deps.services.credentialService.set(cred);

  const data: Record<string, string> = {
    clientId: cred.clientId,
    redirectUri: cred.redirectUri,
    ...(hasEnv ? { env: opts.env as string } : {}),
  };
  renderSuccess(deps.output, data, (d) => `credential saved (clientId: ${d.clientId})`);
}

export async function credShow(deps: CommandDeps): Promise<void> {
  const cred = deps.services.credentialService.get();
  const env = deps.services.configStore.getEnv();
  const data = {
    clientId: cred.clientId,
    redirectUri: cred.redirectUri,
    hasSecret: !!cred.clientSecret,
    maskedSecret: cred.clientSecret ? maskSecret(cred.clientSecret) : undefined,
    env,
  };
  renderSuccess(deps.output, data, (d) => {
    const lines = [
      `clientId:    ${d.clientId}`,
      `redirectUri: ${d.redirectUri}`,
      `secret:      ${d.maskedSecret ?? '(not set)'}`,
      `environment: ${d.env}`,
    ];
    return lines.join('\n');
  });
}

export async function credClear(deps: CommandDeps): Promise<void> {
  deps.services.credentialService.clear();
  renderSuccess(deps.output, { cleared: true }, () => 'credential removed');
}

export function registerCred(parent: Command, deps: CommandDeps): void {
  const cred = parent.command('cred').description('Manage OAuth credentials');

  cred
    .command('set')
    .description('Set or update the OAuth credential')
    .option('--client-id <id>', 'OAuth client id')
    .option('--client-secret <secret>', 'OAuth client secret')
    .option('--redirect-uri <uri>', 'OAuth redirect uri')
    .option('--env <env>', 'default environment (test|prod)')
    .action((opts: CredSetOptions) => credSet(deps, opts));

  cred
    .command('show')
    .description('Print the current credential (masked secret)')
    .action(() => credShow(deps));

  cred
    .command('clear')
    .description('Remove the credential file')
    .action(() => credClear(deps));
}
