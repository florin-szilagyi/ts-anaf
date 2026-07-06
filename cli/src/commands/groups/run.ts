import fs from 'node:fs';
import type { Command } from 'commander';
import type { CommandDeps } from '../buildProgram';
import { CliError } from '../../output/errors';
import { renderSuccess } from '../../output';
import { normalizeManifest, parseManifestFile } from '../../manifest';
import type { EfacturaUploadAction, FastbillInvoiceAction, UblBuildAction } from '../../actions';
import { actionToCreateInput } from './fastbill';

export interface RunCmdOpts {
  file?: string;
  dryRun?: boolean;
}

/**
 * Resolve the active company CUI from the config store.
 */
function resolveActiveCui(deps: CommandDeps): string {
  const activeCui = deps.services.configStore.getActiveCui();
  if (!activeCui) {
    throw new CliError({
      code: 'NO_ACTIVE_COMPANY',
      message: 'No active company. Run `anaf-cli auth login <CUI>` or `anaf-cli auth use <CUI>` first.',
      category: 'local_state',
    });
  }
  return activeCui;
}

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
    renderSuccess(deps.output, action, (a) => JSON.stringify(a, null, 2));
    return;
  }

  if (action.kind === 'ubl.build') {
    await executeUblBuild(deps, action);
    return;
  }
  if (action.kind === 'fastbill.invoice') {
    await executeFastbillInvoice(deps, action);
    return;
  }

  await executeEfacturaUpload(deps, action);
}

async function executeFastbillInvoice(deps: CommandDeps, action: FastbillInvoiceAction): Promise<void> {
  const service = deps.services.fastbillService;
  const created = await service.call({}, (client) =>
    client.createInvoice(actionToCreateInput(action), { idempotencyKey: action.idempotencyKey })
  );

  if (!action.wait) {
    renderSuccess(deps.output, created, (d) => `invoice ${d.id} ${d.status}${d.replayed ? ' (replayed)' : ''}`);
    return;
  }

  const invoice = await service.call({}, (client) =>
    client.waitForInvoice(created.id, {
      timeoutMs: action.timeoutMinutes ? action.timeoutMinutes * 60_000 : undefined,
      onPoll: (i) => deps.output.streams.stderr.write(`status: ${i.status}\n`),
    })
  );
  renderSuccess(deps.output, invoice, (d) => `invoice ${d.id} ${d.status}`);
}

async function executeUblBuild(deps: CommandDeps, action: UblBuildAction): Promise<void> {
  // Use the active company CUI as the context for the build
  const activeCui = resolveActiveCui(deps);
  const resolvedAction: UblBuildAction = { ...action, context: activeCui };
  const result = await deps.services.ublService.buildFromAction(resolvedAction);

  if (action.output.mode === 'file' && action.output.path) {
    fs.writeFileSync(action.output.path, result.xml, 'utf8');
    deps.output.streams.stderr.write(`wrote ${action.output.path}\n`);
    if (deps.output.format !== 'text') {
      renderSuccess(deps.output, {
        invoiceNumber: action.invoice.invoiceNumber,
        xmlPath: action.output.path,
        xmlLength: result.xml.length,
      });
    }
    return;
  }

  if (deps.output.format !== 'text') {
    renderSuccess(deps.output, {
      invoiceNumber: action.invoice.invoiceNumber,
      xmlLength: result.xml.length,
      xmlPath: null,
      xml: result.xml,
    });
    return;
  }

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
    throw new CliError({
      code: 'BAD_USAGE',
      message: 'run: EFacturaUpload with xmlStdin source is not supported — use xmlFile or ublBuild',
      category: 'user_input',
    });
  } else {
    const activeCui = resolveActiveCui(deps);
    const subAction = action.source.build;
    const resolvedSub: UblBuildAction = { ...subAction, context: activeCui };
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
