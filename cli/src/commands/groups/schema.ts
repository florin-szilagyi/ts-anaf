import type { Command } from 'commander';
import type { CommandDeps } from '../buildProgram';
import { CliError } from '../../output/errors';
import { printJsonSchemaForKind } from '../../manifest';
import type { ManifestKind } from '../../manifest';

/**
 * `anaf-cli schema print <kind>` handler.
 *
 * Writes the hand-crafted JSON Schema for a manifest kind to stdout, raw —
 * the output is a JSON document and callers typically pipe it into a file
 * or a schema validator, so we intentionally bypass the success envelope
 * (same pattern as `ubl build` writing raw XML).
 */
export async function schemaPrint(deps: CommandDeps, kindArg: string): Promise<void> {
  if (kindArg !== 'UblBuild' && kindArg !== 'EFacturaUpload') {
    throw new CliError({
      code: 'UNKNOWN_MANIFEST_KIND',
      message: `schema print: unknown kind "${kindArg}" — expected UblBuild or EFacturaUpload`,
      category: 'user_input',
      details: { kind: kindArg },
    });
  }
  const kind: ManifestKind = kindArg;
  const body = printJsonSchemaForKind(kind);
  deps.output.streams.stdout.write(body);
  if (!body.endsWith('\n')) {
    deps.output.streams.stdout.write('\n');
  }
}

export function registerSchema(parent: Command, deps: CommandDeps): void {
  const schema = parent.command('schema').description('Manifest schema utilities');

  schema
    .command('print <kind>')
    .description('Print the JSON schema for a manifest kind (UblBuild | EFacturaUpload)')
    .action((kindArg: string) => schemaPrint(deps, kindArg));
}
