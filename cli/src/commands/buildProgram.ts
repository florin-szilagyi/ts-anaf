import { Command } from 'commander';
import { CLI_NAME, CLI_VERSION } from '../version';
import type { OutputContext } from '../output';
import type { CompanyService, CredentialService, ConfigStore, TokenStore, XdgPaths } from '../state';
import type { LookupService, AuthService, EfacturaService, UblService, FastbillService } from '../services';
import { attachGlobalFlags } from './flags';
import { registerAuth } from './groups/auth';
import { registerCred } from './groups/cred';
import { registerEfactura } from './groups/efactura';
import { registerLookup } from './groups/lookup';
import { registerUbl } from './groups/ubl';
import { registerRun } from './groups/run';
import { registerSchema } from './groups/schema';
import { registerFastbill } from './groups/fastbill';

export interface ServiceRegistry {
  companyService: CompanyService;
  credentialService: CredentialService;
  configStore: ConfigStore;
  lookupService: LookupService;
  tokenStore: TokenStore;
  authService: AuthService;
  efacturaService: EfacturaService;
  ublService: UblService;
  fastbillService: FastbillService;
}

export interface CommandDeps {
  output: OutputContext;
  services: ServiceRegistry;
  paths: XdgPaths;
}

export function buildProgram(deps: CommandDeps): Command {
  const program = new Command();
  program
    .name(CLI_NAME)
    .description('CLI for the ANAF e-Factura SDK')
    .version(CLI_VERSION, '-v, --version', 'print the CLI version');

  attachGlobalFlags(program);

  registerAuth(program, deps);
  registerCred(program, deps);
  registerEfactura(program, deps);
  registerLookup(program, deps);
  registerUbl(program, deps);
  registerFastbill(program, deps);
  registerRun(program, deps);
  registerSchema(program, deps);

  strictifyCommands(program);

  return program;
}

/**
 * Walk every registered (sub)command tree and apply strict parsing:
 *
 * 1. `exitOverride()` — so unknown-option errors throw instead of
 *    calling `process.exit` (Commander only sets this on the command
 *    you call it on, not its children).
 * 2. `configureOutput({ outputError: noop })` — suppress Commander's
 *    built-in stderr writes; our catch block renders the error via
 *    `renderError` in the correct format.
 * 3. Copy global options (`--format`, `--verbose`, `--no-color`) onto
 *    every leaf command so Commander recognises them.
 * 4. `allowUnknownOption(false)` on leaf commands so typos like
 *    `--output` are rejected instead of being silently consumed as
 *    positional arguments.
 */
function strictifyCommands(root: Command): void {
  const globalOptions = root.options.slice();
  (function walk(cmd: Command): void {
    cmd.exitOverride();
    cmd.configureOutput({
      outputError: () => {
        /* suppressed — rendered by runProgram catch block */
      },
    });
    const subs = cmd.commands as Command[];
    if (subs.length === 0) {
      for (const opt of globalOptions) {
        if (!cmd.options.some((o) => o.long === opt.long)) {
          cmd.addOption(opt);
        }
      }
      cmd.allowUnknownOption(false);
    }
    for (const sub of subs) {
      walk(sub);
    }
  })(root);
}
