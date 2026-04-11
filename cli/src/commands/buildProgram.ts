import { Command } from 'commander';
import { CLI_NAME, CLI_VERSION } from '../version';
import type { OutputContext } from '../output';
import type { ContextService, TokenStore } from '../state';
import type { LookupService, AuthService, EfacturaService, UblService } from '../services';
import { attachGlobalFlags } from './flags';
import { registerAuth } from './groups/auth';
import { registerCtx } from './groups/ctx';
import { registerEfactura } from './groups/efactura';
import { registerLookup } from './groups/lookup';
import { registerUbl } from './groups/ubl';
import { registerRun } from './groups/run';
import { registerSchema } from './groups/schema';

/**
 * Registry of REQUIRED service instances passed into the commander program.
 *
 * This shape is the FROZEN service-registry merge pattern: `runProgram` is
 * responsible for filling every field with a default-constructed service when
 * callers do not inject one. Every handler can therefore access
 * `deps.services.<field>` without an existence check.
 *
 * Downstream workstreams MUST append new fields here (and a matching default
 * line in `runProgram.ts`) without removing or reordering existing ones:
 *   P1.5 → tokenStore: TokenStore; authService: AuthService;
 *   P1.7 → lookupService: LookupService;
 *   P2.2 → ublService: UblService;
 *   P2.4 → efacturaService: EfacturaService;
 *   P3.1 → manifestService: ManifestService;
 */
export interface ServiceRegistry {
  contextService: ContextService;
  lookupService: LookupService;
  tokenStore: TokenStore;
  authService: AuthService;
  efacturaService: EfacturaService;
  ublService: UblService;
}

export interface CommandDeps {
  output: OutputContext;
  services: ServiceRegistry;
}

export function buildProgram(deps: CommandDeps): Command {
  const program = new Command();
  program
    .name(CLI_NAME)
    .description('CLI for the ANAF e-Factura SDK')
    .version(CLI_VERSION, '-v, --version', 'print the CLI version');

  attachGlobalFlags(program);

  registerAuth(program, deps);
  registerCtx(program, deps);
  registerEfactura(program, deps);
  registerLookup(program, deps);
  registerUbl(program, deps);
  registerRun(program, deps);
  registerSchema(program, deps);

  return program;
}
