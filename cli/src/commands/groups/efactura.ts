import fs from 'node:fs';
import type { Command } from 'commander';
import type { MessageFilter } from '@florinszilagyi/anaf-ts-sdk';
import type { CommandDeps } from '../buildProgram';
import { CliError } from '../../output/errors';
import { renderSuccess, writeBinary } from '../../output';
import { kv, table } from '../../output/format';

/** Friendly aliases for ANAF message filter codes. */
const FILTER_ALIASES: Record<string, MessageFilter> = {
  sent: 'T' as MessageFilter,
  received: 'P' as MessageFilter,
  errors: 'E' as MessageFilter,
  'buyer-messages': 'R' as MessageFilter,
};

function resolveFilter(raw?: string): MessageFilter | undefined {
  if (!raw) return undefined;
  const alias = FILTER_ALIASES[raw.toLowerCase()];
  if (alias) return alias;
  const upper = raw.toUpperCase();
  if (['T', 'P', 'E', 'R'].includes(upper)) return upper as MessageFilter;
  throw new CliError({
    code: 'BAD_USAGE',
    message: `Invalid --filter "${raw}". Use: sent, received, errors, buyer-messages (or T, P, E, R).`,
    category: 'user_input',
  });
}

interface UploadCmdOpts {
  xml?: string;
  stdin?: boolean;
  clientSecretStdin?: boolean;
  standard?: 'UBL' | 'CN' | 'CII' | 'RASP';
  extern?: boolean;
  autofactura?: boolean;
  executare?: boolean;
}

interface StatusCmdOpts {
  uploadId?: string;
  clientSecretStdin?: boolean;
}

interface DownloadCmdOpts {
  downloadId?: string;
  out?: string;
  clientSecretStdin?: boolean;
}

interface MessagesCmdOpts {
  days?: string;
  filter?: string;
  page?: string;
  startTime?: string;
  endTime?: string;
  clientSecretStdin?: boolean;
}

interface ValidateCmdOpts {
  xml?: string;
  stdin?: boolean;
  standard?: 'FACT1' | 'FCN';
  clientSecretStdin?: boolean;
}

interface ValidateSignatureCmdOpts {
  xml?: string;
  signature?: string;
  clientSecretStdin?: boolean;
}

interface PdfCmdOpts {
  xml?: string;
  stdin?: boolean;
  standard?: 'FACT1' | 'FCN';
  out?: string;
  validation?: boolean;
  clientSecretStdin?: boolean;
}

/**
 * Read the entirety of stdin and return it. Blocks until stdin closes.
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
 * Resolve the OAuth client secret from the credential, env, or stdin.
 */
async function resolveClientSecret(deps: CommandDeps, opts: { clientSecretStdin?: boolean }): Promise<string> {
  const env = process.env.ANAF_CLIENT_SECRET;
  if (env && env.length > 0) return env;
  if (opts.clientSecretStdin) {
    const fromStdin = (await readStdin()).trim();
    if (fromStdin.length > 0) return fromStdin;
  }
  try {
    const cred = deps.services.credentialService.get();
    if (cred.clientSecret && cred.clientSecret.length > 0) return cred.clientSecret;
  } catch {
    // Credential not configured — fall through to error
  }
  throw new CliError({
    code: 'CLIENT_SECRET_MISSING',
    message:
      'OAuth client secret is required. Set ANAF_CLIENT_SECRET, pass --client-secret-stdin, or store it in the credential.',
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
  const clientSecret = await resolveClientSecret(deps, opts);
  const response = await deps.services.efacturaService.upload({
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
  renderSuccess(deps.output, response, (d) => kv([['Upload ID', String(d.indexIncarcare)]]));
}

export async function efacturaUploadB2C(deps: CommandDeps, opts: UploadCmdOpts): Promise<void> {
  const xml = await resolveXmlInput(opts);
  const clientSecret = await resolveClientSecret(deps, opts);
  const response = await deps.services.efacturaService.upload({
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
  renderSuccess(deps.output, response, (d) => kv([['Upload ID (B2C)', String(d.indexIncarcare)]]));
}

export async function efacturaStatus(deps: CommandDeps, opts: StatusCmdOpts): Promise<void> {
  if (!opts.uploadId) {
    throw new CliError({
      code: 'BAD_USAGE',
      message: 'efactura status: --upload-id is required',
      category: 'user_input',
    });
  }
  const clientSecret = await resolveClientSecret(deps, opts);
  const response = await deps.services.efacturaService.getStatus({
    uploadId: opts.uploadId,
    clientSecret,
  });
  renderSuccess(deps.output, response, (d) =>
    kv([
      ['Status', d.stare],
      ['Download ID', d.idDescarcare ?? undefined],
    ])
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
  const clientSecret = await resolveClientSecret(deps, opts);
  const bytes = await deps.services.efacturaService.download({
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
  const clientSecret = await resolveClientSecret(deps, opts);

  const filter = resolveFilter(opts.filter);

  const response = await deps.services.efacturaService.getMessages({
    clientSecret,
    days,
    filter,
    startTime,
    endTime,
    page,
  });
  renderSuccess(deps.output, response, (d) => {
    const messages = (
      d as {
        mesaje?: Array<{
          id?: string;
          tip?: string;
          data_creare?: string;
          cif_emitent?: string;
          emitentName?: string;
          cif_beneficiar?: string;
          beneficiarName?: string;
        }>;
      }
    ).mesaje;
    if (!messages || messages.length === 0) return '(no messages)';
    return table(
      [
        { key: 'id', header: 'ID' },
        { key: 'tip', header: 'Type' },
        { key: 'data_creare', header: 'Created' },
        { key: 'cif_emitent', header: 'Emitter CUI' },
        { key: 'emitentName', header: 'Emitter' },
        { key: 'cif_beneficiar', header: 'Beneficiary CUI' },
        { key: 'beneficiarName', header: 'Beneficiary' },
      ],
      messages.map((m) => ({
        id: m.id ?? '?',
        tip: m.tip ?? '',
        data_creare: m.data_creare ?? '',
        cif_emitent: m.cif_emitent ?? '',
        emitentName: m.emitentName ?? '',
        cif_beneficiar: m.cif_beneficiar ?? '',
        beneficiarName: m.beneficiarName ?? '',
      }))
    );
  });
}

export async function efacturaValidate(deps: CommandDeps, opts: ValidateCmdOpts): Promise<void> {
  const xml = await resolveXmlInput(opts);
  const clientSecret = await resolveClientSecret(deps, opts);
  const result = await deps.services.efacturaService.validateXml({
    clientSecret,
    xml,
    standard: opts.standard ?? 'FACT1',
  });
  renderSuccess(deps.output, result, (d) =>
    kv([
      ['Result', d.valid ? 'VALID' : 'INVALID'],
      ['Details', d.details ?? undefined],
    ])
  );
  if (!result.valid) {
    throw new CliError({
      code: 'VALIDATION_FAILED',
      message: `document is not valid: ${result.details ?? ''}`,
      category: 'anaf_api',
      details: { info: result.info },
    });
  }
}

export async function efacturaValidateSignature(deps: CommandDeps, opts: ValidateSignatureCmdOpts): Promise<void> {
  if (!opts.xml) {
    throw new CliError({
      code: 'BAD_USAGE',
      message: 'efactura validate-signature: --xml <path> is required',
      category: 'user_input',
    });
  }
  if (!opts.signature) {
    throw new CliError({
      code: 'BAD_USAGE',
      message: 'efactura validate-signature: --signature <path> is required',
      category: 'user_input',
    });
  }
  const clientSecret = await resolveClientSecret(deps, opts);
  const xmlBytes = fs.readFileSync(opts.xml);
  const sigBytes = fs.readFileSync(opts.signature);
  const result = await deps.services.efacturaService.validateSignature({
    clientSecret,
    xml: xmlBytes,
    signature: sigBytes,
    xmlFilename: opts.xml,
    signatureFilename: opts.signature,
  });
  renderSuccess(deps.output, result, (d) =>
    kv([
      ['Result', d.valid ? 'VALID' : 'INVALID'],
      ['Details', d.details ?? undefined],
    ])
  );
  if (!result.valid) {
    throw new CliError({
      code: 'SIGNATURE_VALIDATION_FAILED',
      message: `signature is not valid: ${result.details ?? ''}`,
      category: 'anaf_api',
    });
  }
}

export async function efacturaPdf(deps: CommandDeps, opts: PdfCmdOpts): Promise<void> {
  const xml = await resolveXmlInput(opts);
  const clientSecret = await resolveClientSecret(deps, opts);
  const noValidation = opts.validation === false;
  const bytes = await deps.services.efacturaService.convertToPdf({
    clientSecret,
    xml,
    standard: opts.standard ?? 'FACT1',
    noValidation,
  });
  writeBinary(deps.output, bytes, { path: opts.out });
}

export function registerEfactura(parent: Command, deps: CommandDeps): void {
  const efactura = parent.command('efactura').description('e-Factura document operations');

  efactura
    .command('upload')
    .description('Upload an XML document to e-Factura')
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
    .option('--xml <path>', 'path to XML file')
    .option('--stdin', 'read XML from stdin')
    .option('--client-secret-stdin', 'read OAuth client secret from stdin')
    .option('--standard <std>', 'document standard (UBL|CN|CII|RASP)')
    .action((opts: UploadCmdOpts) => efacturaUploadB2C(deps, opts));

  efactura
    .command('status')
    .description('Check upload status')
    .option('--upload-id <id>', 'ANAF upload id')
    .option('--client-secret-stdin', 'read OAuth client secret from stdin')
    .action((opts: StatusCmdOpts) => efacturaStatus(deps, opts));

  efactura
    .command('download')
    .description('Download an e-Factura document by id')
    .option('--download-id <id>', 'ANAF download id')
    .option('--out <path>', 'output file path')
    .option('--client-secret-stdin', 'read OAuth client secret from stdin')
    .action((opts: DownloadCmdOpts) => efacturaDownload(deps, opts));

  efactura
    .command('messages')
    .description('List recent e-Factura messages')
    .option('--days <n>', 'lookback window in days')
    .option('--filter <type>', 'sent | received | errors | buyer-messages (or raw: T|P|E|R)')
    .option('--page <n>', 'page number')
    .option('--start-time <ms>', 'pagination start time (epoch ms)')
    .option('--end-time <ms>', 'pagination end time (epoch ms)')
    .option('--client-secret-stdin', 'read OAuth client secret from stdin')
    .action((opts: MessagesCmdOpts) => efacturaMessages(deps, opts));

  efactura
    .command('validate')
    .description('Validate an XML document via the ANAF tools service')
    .option('--xml <path>', 'path to XML file')
    .option('--stdin', 'read XML from stdin')
    .option('--standard <std>', 'standard (FACT1|FCN)')
    .option('--client-secret-stdin', 'read OAuth client secret from stdin')
    .action((opts: ValidateCmdOpts) => efacturaValidate(deps, opts));

  efactura
    .command('validate-signature')
    .description('Validate an XML signature via ANAF')
    .option('--xml <path>', 'path to XML file')
    .option('--signature <path>', 'path to signature file')
    .option('--client-secret-stdin', 'read OAuth client secret from stdin')
    .action((opts: ValidateSignatureCmdOpts) => efacturaValidateSignature(deps, opts));

  efactura
    .command('pdf')
    .description('Convert an XML document to PDF via ANAF')
    .option('--xml <path>', 'path to XML file')
    .option('--stdin', 'read XML from stdin')
    .option('--standard <std>', 'standard (FACT1|FCN)')
    .option('--no-validation', 'use the no-validation conversion endpoint')
    .option('--out <path>', 'output PDF file path')
    .option('--client-secret-stdin', 'read OAuth client secret from stdin')
    .action((opts: PdfCmdOpts) => efacturaPdf(deps, opts));
}
