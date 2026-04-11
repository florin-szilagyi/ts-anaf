import fs from 'node:fs';
import type { Command } from 'commander';
import type { MessageFilter } from 'anaf-ts-sdk';
import type { CommandDeps } from '../buildProgram';
import { CliError } from '../../output/errors';
import { renderSuccess, writeBinary } from '../../output';
import { notImplemented } from '../notImplemented';

interface UploadCmdOpts {
  context?: string;
  xml?: string;
  stdin?: boolean;
  clientSecretStdin?: boolean;
  standard?: 'UBL' | 'CN' | 'CII' | 'RASP';
  extern?: boolean;
  autofactura?: boolean;
  executare?: boolean;
}

interface StatusCmdOpts {
  context?: string;
  uploadId?: string;
  clientSecretStdin?: boolean;
}

interface DownloadCmdOpts {
  context?: string;
  downloadId?: string;
  out?: string;
  clientSecretStdin?: boolean;
}

interface MessagesCmdOpts {
  context?: string;
  days?: string;
  filter?: string;
  page?: string;
  startTime?: string;
  endTime?: string;
  clientSecretStdin?: boolean;
}

/**
 * Read the entirety of stdin and return it. Blocks until stdin closes.
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
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

/**
 * Resolve the OAuth client secret from env or stdin. Duplicates a thin slice
 * of `AuthService.resolveSecret` so the handlers stay free of service
 * construction — if duplication grows, P3.x can extract a shared util.
 */
async function resolveClientSecret(opts: { clientSecretStdin?: boolean }): Promise<string> {
  const env = process.env.ANAF_CLIENT_SECRET;
  if (env && env.length > 0) return env;
  if (opts.clientSecretStdin) {
    const fromStdin = (await readStdin()).trim();
    if (fromStdin.length > 0) return fromStdin;
  }
  throw new CliError({
    code: 'CLIENT_SECRET_MISSING',
    message: 'OAuth client secret is required. Set ANAF_CLIENT_SECRET or pass --client-secret-stdin.',
    category: 'auth',
  });
}

async function resolveXmlInput(opts: { xml?: string; stdin?: boolean }): Promise<string> {
  if (opts.xml && opts.stdin) {
    throw new CliError({
      code: 'BAD_USAGE',
      message: '--xml and --stdin are mutually exclusive',
      category: 'user_input',
    });
  }
  if (opts.xml) {
    return fs.readFileSync(opts.xml, 'utf8');
  }
  if (opts.stdin) {
    return readStdin();
  }
  throw new CliError({
    code: 'BAD_USAGE',
    message: 'provide --xml <path> or --stdin',
    category: 'user_input',
  });
}

function parseNumberOpt(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new CliError({
      code: 'BAD_USAGE',
      message: `${name}: expected a number, got "${value}"`,
      category: 'user_input',
    });
  }
  return n;
}

export async function efacturaUpload(deps: CommandDeps, opts: UploadCmdOpts): Promise<void> {
  const xml = await resolveXmlInput(opts);
  const clientSecret = await resolveClientSecret(opts);
  const response = await deps.services.efacturaService.upload({
    contextName: opts.context,
    xml,
    clientSecret,
    isB2C: false,
    options: {
      standard: opts.standard ?? 'UBL',
      extern: opts.extern,
      autofactura: opts.autofactura,
      executare: opts.executare,
    },
  });
  renderSuccess(deps.output, response, (d) => `upload accepted: ${d.indexIncarcare}`);
}

export async function efacturaUploadB2C(deps: CommandDeps, opts: UploadCmdOpts): Promise<void> {
  const xml = await resolveXmlInput(opts);
  const clientSecret = await resolveClientSecret(opts);
  const response = await deps.services.efacturaService.upload({
    contextName: opts.context,
    xml,
    clientSecret,
    isB2C: true,
    options: {
      standard: opts.standard ?? 'UBL',
      extern: opts.extern,
      autofactura: opts.autofactura,
      executare: opts.executare,
    },
  });
  renderSuccess(deps.output, response, (d) => `B2C upload accepted: ${d.indexIncarcare}`);
}

export async function efacturaStatus(deps: CommandDeps, opts: StatusCmdOpts): Promise<void> {
  if (!opts.uploadId) {
    throw new CliError({
      code: 'BAD_USAGE',
      message: 'efactura status: --upload-id is required',
      category: 'user_input',
    });
  }
  const clientSecret = await resolveClientSecret(opts);
  const response = await deps.services.efacturaService.getStatus({
    contextName: opts.context,
    uploadId: opts.uploadId,
    clientSecret,
  });
  renderSuccess(
    deps.output,
    response,
    (d) => `status: ${d.stare}${d.idDescarcare ? ` (download id: ${d.idDescarcare})` : ''}`
  );
}

export async function efacturaDownload(deps: CommandDeps, opts: DownloadCmdOpts): Promise<void> {
  if (!opts.downloadId) {
    throw new CliError({
      code: 'BAD_USAGE',
      message: 'efactura download: --download-id is required',
      category: 'user_input',
    });
  }
  const clientSecret = await resolveClientSecret(opts);
  const bytes = await deps.services.efacturaService.download({
    contextName: opts.context,
    downloadId: opts.downloadId,
    clientSecret,
  });
  writeBinary(deps.output, bytes, { path: opts.out });
}

export async function efacturaMessages(deps: CommandDeps, opts: MessagesCmdOpts): Promise<void> {
  const days = parseNumberOpt(opts.days, '--days');
  const startTime = parseNumberOpt(opts.startTime, '--start-time');
  const endTime = parseNumberOpt(opts.endTime, '--end-time');
  const page = parseNumberOpt(opts.page, '--page');
  const clientSecret = await resolveClientSecret(opts);

  const response = await deps.services.efacturaService.getMessages({
    contextName: opts.context,
    clientSecret,
    days,
    filter: opts.filter as MessageFilter | undefined,
    startTime,
    endTime,
    page,
  });
  renderSuccess(deps.output, response, (d) => {
    const messages = (d as { mesaje?: Array<{ id?: string; tip?: string; data_creare?: string }> }).mesaje;
    if (!messages || messages.length === 0) return '(no messages)';
    return messages.map((m) => `${m.id ?? '?'}\t${m.tip ?? ''}\t${m.data_creare ?? ''}`).join('\n');
  });
}

export function registerEfactura(parent: Command, deps: CommandDeps): void {
  const efactura = parent.command('efactura').description('e-Factura document operations');

  efactura
    .command('upload')
    .description('Upload an XML document to e-Factura')
    .option('--context <name>', 'context name override')
    .option('--xml <path>', 'path to XML file')
    .option('--stdin', 'read XML from stdin')
    .option('--client-secret-stdin', 'read OAuth client secret from stdin')
    .option('--standard <std>', 'document standard (UBL|CN|CII|RASP)')
    .option('--extern', 'mark as external invoice')
    .option('--autofactura', 'mark as self-invoice')
    .option('--executare', 'execute immediately')
    .action((opts: UploadCmdOpts) => efacturaUpload(deps, opts));

  efactura
    .command('upload-b2c')
    .description('Upload a B2C XML document')
    .option('--context <name>', 'context name override')
    .option('--xml <path>', 'path to XML file')
    .option('--stdin', 'read XML from stdin')
    .option('--client-secret-stdin', 'read OAuth client secret from stdin')
    .option('--standard <std>', 'document standard (UBL|CN|CII|RASP)')
    .action((opts: UploadCmdOpts) => efacturaUploadB2C(deps, opts));

  efactura
    .command('status')
    .description('Check upload status')
    .option('--context <name>', 'context name override')
    .option('--upload-id <id>', 'ANAF upload id')
    .option('--client-secret-stdin', 'read OAuth client secret from stdin')
    .action((opts: StatusCmdOpts) => efacturaStatus(deps, opts));

  efactura
    .command('download')
    .description('Download an e-Factura document by id')
    .option('--context <name>', 'context name override')
    .option('--download-id <id>', 'ANAF download id')
    .option('--out <path>', 'output file path')
    .option('--client-secret-stdin', 'read OAuth client secret from stdin')
    .action((opts: DownloadCmdOpts) => efacturaDownload(deps, opts));

  efactura
    .command('messages')
    .description('List recent e-Factura messages')
    .option('--context <name>', 'context name override')
    .option('--days <n>', 'lookback window in days')
    .option('--filter <code>', 'message filter code: T|P|E|R')
    .option('--page <n>', 'page number')
    .option('--start-time <ms>', 'pagination start time (epoch ms)')
    .option('--end-time <ms>', 'pagination end time (epoch ms)')
    .option('--client-secret-stdin', 'read OAuth client secret from stdin')
    .action((opts: MessagesCmdOpts) => efacturaMessages(deps, opts));

  // P3.3 owns these — keep as stubs for now.
  efactura
    .command('validate')
    .description('Validate an XML document via the ANAF tools service')
    .option('--xml <path>', 'path to XML file')
    .option('--standard <std>', 'standard (e.g. FACT1)')
    .action(() => notImplemented('efactura validate'));

  efactura
    .command('validate-signature')
    .description('Validate an XML signature via ANAF')
    .option('--xml <path>', 'path to XML file')
    .option('--signature <path>', 'path to signature file')
    .action(() => notImplemented('efactura validate-signature'));

  efactura
    .command('pdf')
    .description('Convert an XML document to PDF via ANAF')
    .option('--xml <path>', 'path to XML file')
    .option('--standard <std>', 'standard (e.g. FACT1)')
    .option('--no-validation', 'use the no-validation conversion endpoint')
    .option('--out <path>', 'output PDF file path')
    .action(() => notImplemented('efactura pdf'));
}
