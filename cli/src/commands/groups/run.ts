import fs from 'node:fs';
import type { Command } from 'commander';
import type { CommandDeps } from '../buildProgram';
import { CliError } from '../../output/errors';
import { renderSuccess } from '../../output';
import { normalizeManifest, parseManifestFile } from '../../manifest';
import type { EfacturaUploadAction, UblBuildAction } from '../../actions';

export interface RunCmdOpts {
  file?: string;
  dryRun?: boolean;
}

/**
 * `anaf-cli run -f <path> [--dry-run]` handler.
 *
 * Parses a YAML/JSON manifest, normalizes it into an action via the action
 * normalizers from P2.1, then dispatches on `action.kind` through the
 * existing `ublService` / `efacturaService`. `--dry-run` stops after
 * normalization and emits the action as JSON (both text + json output
 * modes — agents consume the raw action).
 */
export async function runCommand(deps: CommandDeps, opts: RunCmdOpts): Promise<void> {
  if (!opts.file) {
    throw new CliError({
      code: 'BAD_USAGE',
      message: 'run: --file <path> is required',
      category: 'user_input',
    });
  }
  const doc = parseManifestFile(opts.file);
  const action = normalizeManifest(doc);

  if (opts.dryRun) {
    // Dry-run path goes through renderSuccess so the JSON envelope stays
    // correct in --json mode and the text path prints pretty-printed JSON
    // (which is the useful artifact for agents to eyeball).
    renderSuccess(deps.output, action, (a) => JSON.stringify(a, null, 2));
    return;
  }

  if (action.kind === 'ubl.build') {
    await executeUblBuild(deps, action);
    return;
  }

  await executeEfacturaUpload(deps, action);
}

async function executeUblBuild(deps: CommandDeps, action: UblBuildAction): Promise<void> {
  // Re-resolve the context so that a manifest referring to "(current)" or
  // an abbreviated alias still maps onto a real context file.
  const resolvedContext = deps.services.contextService.resolve(action.context).name;
  const resolvedAction: UblBuildAction = { ...action, context: resolvedContext };
  const result = await deps.services.ublService.buildFromAction(resolvedAction);

  if (action.output.mode === 'file' && action.output.path) {
    fs.writeFileSync(action.output.path, result.xml, 'utf8');
    deps.output.streams.stderr.write(`wrote ${action.output.path}\n`);
    // In JSON mode we still want a structured envelope so the caller can
    // confirm the write programmatically.
    if (deps.output.format === 'json') {
      renderSuccess(deps.output, {
        invoiceNumber: action.invoice.invoiceNumber,
        xmlPath: action.output.path,
        xmlLength: result.xml.length,
      });
    }
    return;
  }

  if (deps.output.format === 'json') {
    renderSuccess(deps.output, {
      invoiceNumber: action.invoice.invoiceNumber,
      xmlLength: result.xml.length,
      xmlPath: null,
      xml: result.xml,
    });
    return;
  }

  // Raw XML to stdout — matches the imperative `ubl build` command.
  deps.output.streams.stdout.write(result.xml);
  if (!result.xml.endsWith('\n')) {
    deps.output.streams.stdout.write('\n');
  }
}

async function executeEfacturaUpload(deps: CommandDeps, action: EfacturaUploadAction): Promise<void> {
  let xml: string;
  if (action.source.type === 'xmlFile') {
    try {
      xml = fs.readFileSync(action.source.path, 'utf8');
    } catch (cause) {
      throw new CliError({
        code: 'BAD_USAGE',
        message: `run: failed to read xmlFile "${action.source.path}": ${(cause as Error).message}`,
        category: 'user_input',
        details: { path: action.source.path },
      });
    }
  } else if (action.source.type === 'xmlStdin') {
    // Manifests are meant to be deterministic — reading stdin in a scripted
    // pipeline is a footgun we deliberately refuse. If the user really
    // wants stdin, they can use the imperative `efactura upload --stdin`.
    throw new CliError({
      code: 'BAD_USAGE',
      message: 'run: EFacturaUpload with xmlStdin source is not supported — use xmlFile or ublBuild',
      category: 'user_input',
    });
  } else {
    const subAction = action.source.build;
    const resolvedContext = deps.services.contextService.resolve(subAction.context).name;
    const resolvedSub: UblBuildAction = { ...subAction, context: resolvedContext };
    const result = await deps.services.ublService.buildFromAction(resolvedSub);
    xml = result.xml;
  }

  const clientSecret = process.env.ANAF_CLIENT_SECRET;
  if (!clientSecret || clientSecret.length === 0) {
    throw new CliError({
      code: 'CLIENT_SECRET_MISSING',
      message: 'ANAF_CLIENT_SECRET env var is required for manifest EFacturaUpload',
      category: 'auth',
    });
  }

  const response = await deps.services.efacturaService.upload({
    contextName: action.context,
    xml,
    clientSecret,
    isB2C: action.upload.isB2C ?? false,
    options: {
      standard: action.upload.standard,
      executare: action.upload.isExecutare,
    },
  });
  renderSuccess(deps.output, response, (d) => `upload accepted: ${d.indexIncarcare}`);
}

export function registerRun(parent: Command, deps: CommandDeps): void {
  parent
    .command('run')
    .description('Execute a manifest file (YAML or JSON)')
    .option('-f, --file <path>', 'path to the manifest file')
    .option('--dry-run', 'normalize the action but do not execute')
    .action((opts: RunCmdOpts) => runCommand(deps, opts));
}
