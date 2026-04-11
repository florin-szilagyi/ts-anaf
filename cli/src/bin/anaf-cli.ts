#!/usr/bin/env node
import { Command } from 'commander';
import { CLI_NAME, CLI_VERSION } from '../version';

const program = new Command();

program
  .name(CLI_NAME)
  .description('CLI for the ANAF e-Factura SDK')
  .version(CLI_VERSION, '-v, --version', 'print the CLI version');

// Full command tree is registered in P1.2. For P1.1, the bin only needs --version and --help.
program.parseAsync(process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`${CLI_NAME}: ${message}\n`);
  process.exit(1);
});
