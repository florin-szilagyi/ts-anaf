import type { Command } from 'commander';
import type { CreateInvoiceInput, InvoiceResource } from '@florinszilagyi/fastbill-sdk';
import type { CommandDeps } from '../buildProgram';
import { CliError } from '../../output/errors';
import { renderSuccess, writeBinary } from '../../output';
import { kv, table } from '../../output/format';
import { parseInvoiceLines, type FastbillInvoiceAction } from '../../actions';

/**
 * `anaf-cli fastbill …` — drive the fastbill API (https://fastbill.app) with
 * an sk_test/sk_live key instead of ANAF OAuth. Global connection flags on
 * every subcommand: --api-key, --base-url (else FASTBILL_API_KEY /
 * FASTBILL_BASE_URL env, else the stored key from `fastbill auth set-key`).
 */

interface ConnOpts {
  apiKey?: string;
  baseUrl?: string;
}

interface SetKeyOpts extends ConnOpts {
  stdin?: boolean;
}

interface CreateOpts extends ConnOpts {
  companyId?: string;
  number?: string;
  issueDate?: string;
  dueDate?: string;
  customerCui?: string;
  line?: string[];
  currency?: string;
  note?: string;
  iban?: string;
  idempotencyKey?: string;
  wait?: boolean;
  timeout?: string;
}

interface WaitOpts extends ConnOpts {
  timeout?: string;
}

interface LsOpts extends ConnOpts {
  status?: string;
  direction?: string;
  from?: string;
  to?: string;
  counterpartyCif?: string;
  companyId?: string;
  limit?: string;
  cursor?: string;
}

interface DownloadOpts extends ConnOpts {
  kind?: string;
  out?: string;
}

function conn(opts: ConnOpts): { apiKey?: string; baseUrl?: string } {
  return { apiKey: opts.apiKey, baseUrl: opts.baseUrl };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

export async function fastbillSetKey(deps: CommandDeps, opts: SetKeyOpts): Promise<void> {
  const apiKey = opts.stdin ? await readStdin() : opts.apiKey;
  if (!apiKey) {
    throw new CliError({
      code: 'BAD_USAGE',
      message: 'fastbill auth set-key: pass --api-key <key> or --stdin',
      category: 'user_input',
    });
  }
  const { mode } = deps.services.fastbillService.setKey(apiKey, opts.baseUrl);
  renderSuccess(deps.output, { stored: true, mode }, () => `Stored fastbill ${mode} key.`);
}

export async function fastbillClearKey(deps: CommandDeps): Promise<void> {
  deps.services.fastbillService.clearKey();
  renderSuccess(deps.output, { cleared: true }, () => 'Removed the stored fastbill key.');
}

export async function fastbillStatus(deps: CommandDeps, opts: ConnOpts): Promise<void> {
  const client = deps.services.fastbillService.client(conn(opts));
  const companies = await deps.services.fastbillService.call(conn(opts), (c) => c.listCompanies());
  renderSuccess(deps.output, { mode: client.mode, companies: companies.length }, (d) =>
    kv([
      ['mode', d.mode],
      ['companies', String(d.companies)],
    ])
  );
}

export async function fastbillCompanies(deps: CommandDeps, opts: ConnOpts): Promise<void> {
  const companies = await deps.services.fastbillService.call(conn(opts), (c) => c.listCompanies());
  renderSuccess(deps.output, { companies }, (d) =>
    table(
      [
        { key: 'id', header: 'ID' },
        { key: 'cif', header: 'CUI' },
        { key: 'name', header: 'NAME' },
        { key: 'spv', header: 'SPV' },
        { key: 'archive', header: 'ARCHIVE' },
      ],
      d.companies.map((c) => ({
        id: c.id,
        cif: c.cif,
        name: c.name,
        spv: c.spvVerified ? 'verified' : 'unverified',
        archive: c.archiveEnabled ? 'on' : 'off',
      }))
    )
  );
}

/** Build the SDK payload shared by `invoices create` and `validate`. */
function createInputFromFlags(opts: CreateOpts): CreateInvoiceInput {
  const required: Array<[string, unknown]> = [
    ['--company-id', opts.companyId],
    ['--number', opts.number],
    ['--issue-date', opts.issueDate],
    ['--customer-cui', opts.customerCui],
    ['--line', opts.line?.length],
  ];
  const missing = required.filter(([, v]) => !v).map(([flag]) => flag);
  if (missing.length > 0) {
    throw new CliError({
      code: 'BAD_USAGE',
      message: `fastbill: missing required flags: ${missing.join(', ')}`,
      category: 'user_input',
    });
  }
  return {
    companyId: opts.companyId as string,
    invoiceNumber: opts.number as string,
    issueDate: opts.issueDate as string,
    dueDate: opts.dueDate,
    customerCui: opts.customerCui as string,
    lines: parseInvoiceLines(opts.line ?? []),
    currency: opts.currency,
    note: opts.note,
    paymentIban: opts.iban,
  };
}

export function actionToCreateInput(action: FastbillInvoiceAction): CreateInvoiceInput {
  return {
    companyId: action.invoice.companyId,
    invoiceNumber: action.invoice.invoiceNumber,
    issueDate: action.invoice.issueDate,
    dueDate: action.invoice.dueDate,
    customerCui: action.invoice.customerCui,
    lines: action.invoice.lines,
    currency: action.invoice.currency,
    taxCurrencyTaxAmount: action.invoice.taxCurrencyTaxAmount,
    note: action.invoice.note,
    paymentIban: action.invoice.paymentIban,
  };
}

function invoiceHuman(inv: InvoiceResource): string {
  return kv([
    ['id', inv.id],
    ['status', inv.status],
    ['number', inv.invoiceNumber ?? '—'],
    ['mode', inv.mode],
    ['counterparty', inv.counterpartyName ?? inv.counterpartyCif ?? '—'],
    ['total', inv.totalAmount ? `${inv.totalAmount} ${inv.currency}` : '—'],
    ['anaf upload index', inv.anafUploadIndex ?? '—'],
    ['error', inv.error ? JSON.stringify(inv.error) : '—'],
  ]);
}

function timeoutMs(minutes: string | number | undefined): number | undefined {
  if (minutes === undefined) return undefined;
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) {
    throw new CliError({
      code: 'BAD_USAGE',
      message: '--timeout must be a positive number of minutes',
      category: 'user_input',
    });
  }
  return n * 60_000;
}

export async function fastbillCreate(deps: CommandDeps, opts: CreateOpts): Promise<void> {
  const input = createInputFromFlags(opts);
  const service = deps.services.fastbillService;
  const created = await service.call(conn(opts), (c) =>
    c.createInvoice(input, { idempotencyKey: opts.idempotencyKey })
  );

  if (!opts.wait) {
    renderSuccess(deps.output, created, (d) =>
      kv([
        ['id', d.id],
        ['status', d.status],
        ['replayed', d.replayed ? 'yes (idempotent replay)' : 'no'],
      ])
    );
    return;
  }

  const invoice = await service.call(conn(opts), (c) =>
    c.waitForInvoice(created.id, {
      timeoutMs: timeoutMs(opts.timeout),
      onPoll: (i) => deps.output.streams.stderr.write(`status: ${i.status}\n`),
    })
  );
  renderSuccess(deps.output, invoice, invoiceHuman);
}

export async function fastbillGet(deps: CommandDeps, id: string, opts: ConnOpts): Promise<void> {
  const invoice = await deps.services.fastbillService.call(conn(opts), (c) => c.getInvoice(id));
  renderSuccess(deps.output, invoice, invoiceHuman);
}

export async function fastbillWait(deps: CommandDeps, id: string, opts: WaitOpts): Promise<void> {
  const invoice = await deps.services.fastbillService.call(conn(opts), (c) =>
    c.waitForInvoice(id, {
      timeoutMs: timeoutMs(opts.timeout),
      onPoll: (i) => deps.output.streams.stderr.write(`status: ${i.status}\n`),
    })
  );
  renderSuccess(deps.output, invoice, invoiceHuman);
}

export async function fastbillLs(deps: CommandDeps, opts: LsOpts): Promise<void> {
  const result = await deps.services.fastbillService.call(conn(opts), (c) =>
    c.listInvoices({
      status: opts.status as never,
      direction: opts.direction as never,
      from: opts.from,
      to: opts.to,
      counterpartyCif: opts.counterpartyCif,
      companyId: opts.companyId,
      limit: opts.limit ? Number(opts.limit) : undefined,
      cursor: opts.cursor,
    })
  );
  renderSuccess(deps.output, result, (d) => {
    const rows = table(
      [
        { key: 'id', header: 'ID' },
        { key: 'number', header: 'NUMBER' },
        { key: 'dir', header: 'DIR' },
        { key: 'status', header: 'STATUS' },
        { key: 'total', header: 'TOTAL' },
        { key: 'counterparty', header: 'COUNTERPARTY' },
      ],
      d.invoices.map((i) => ({
        id: i.id,
        number: i.invoiceNumber ?? '—',
        dir: i.direction === 'outbound' ? '→' : '←',
        status: i.status,
        total: i.totalAmount ? `${i.totalAmount} ${i.currency}` : '—',
        counterparty: i.counterpartyName ?? i.counterpartyCif ?? '—',
      }))
    );
    return d.nextCursor ? `${rows}\nnext cursor: ${d.nextCursor}` : rows;
  });
}

export async function fastbillDownload(deps: CommandDeps, id: string, opts: DownloadOpts): Promise<void> {
  const kind = opts.kind ?? 'zip';
  if (!['xml', 'zip', 'pdf'].includes(kind)) {
    throw new CliError({ code: 'BAD_USAGE', message: '--kind must be xml, zip or pdf', category: 'user_input' });
  }
  const bytes = await deps.services.fastbillService.call(conn(opts), (c) =>
    kind === 'xml' ? c.downloadXml(id) : kind === 'pdf' ? c.downloadPdf(id) : c.downloadZip(id)
  );
  writeBinary(deps.output, bytes, { path: opts.out });
}

export async function fastbillValidate(deps: CommandDeps, opts: CreateOpts): Promise<void> {
  const input = createInputFromFlags(opts);
  const result = await deps.services.fastbillService.call(conn(opts), (c) => c.validateInvoice(input));
  renderSuccess(deps.output, result, (d) =>
    kv([
      ['valid', d.valid ? 'yes' : 'no'],
      ['details', d.details ?? '—'],
    ])
  );
}

export function registerFastbill(parent: Command, deps: CommandDeps): void {
  const fastbill = parent.command('fastbill').description('Invoice through the fastbill API (sk_test/sk_live keys)');

  const withConn = (cmd: Command): Command =>
    cmd
      .option('--api-key <key>', 'fastbill API key (overrides FASTBILL_API_KEY and the stored key)')
      .option('--base-url <url>', 'fastbill API origin (overrides FASTBILL_BASE_URL)');

  const auth = fastbill.command('auth').description('Manage the stored fastbill API key');
  withConn(auth.command('set-key').description('Store an API key (chmod 0600)'))
    .option('--stdin', 'read the key from stdin instead of --api-key')
    .action((opts: SetKeyOpts) => fastbillSetKey(deps, opts));
  auth
    .command('clear')
    .description('Remove the stored API key')
    .action(() => fastbillClearKey(deps));
  withConn(auth.command('status').description('Check connectivity and key mode')).action((opts: ConnOpts) =>
    fastbillStatus(deps, opts)
  );

  withConn(fastbill.command('companies').description('List companies available to this key')).action((opts: ConnOpts) =>
    fastbillCompanies(deps, opts)
  );

  const invoices = fastbill.command('invoices').description('Create and query invoices');
  withConn(invoices.command('create').description('Create an invoice (async 202 unless --wait)'))
    .option('--company-id <uuid>', 'supplier company id (see `fastbill companies`)')
    .option('--number <number>', 'invoice number')
    .option('--issue-date <date>', 'issue date (YYYY-MM-DD)')
    .option('--due-date <date>', 'due date (YYYY-MM-DD)')
    .option('--customer-cui <cui>', 'customer CUI (RO prefix optional)')
    .option('--line <line>', 'invoice line "desc|qty|price|tax[|unitCode]" (repeatable)', collect, [])
    .option('--currency <code>', 'ISO currency (default RON)')
    .option('--note <text>', 'invoice note')
    .option('--iban <iban>', 'payment IBAN')
    .option('--idempotency-key <key>', 'idempotency key (auto-generated when omitted)')
    .option('--wait', 'poll until ANAF validates or rejects the invoice')
    .option('--timeout <minutes>', 'wait budget in minutes (default 30)')
    .action((opts: CreateOpts) => fastbillCreate(deps, opts));
  withConn(invoices.command('get <id>').description('Fetch an invoice (the polling endpoint)')).action(
    (id: string, opts: ConnOpts) => fastbillGet(deps, id, opts)
  );
  withConn(invoices.command('wait <id>').description('Poll an invoice until it reaches a terminal status'))
    .option('--timeout <minutes>', 'wait budget in minutes (default 30)')
    .action((id: string, opts: WaitOpts) => fastbillWait(deps, id, opts));
  withConn(invoices.command('ls').description('List invoices (cursor pagination)'))
    .option('--status <status>', 'filter by status')
    .option('--direction <dir>', 'outbound | inbound')
    .option('--from <date>', 'issue date from (YYYY-MM-DD)')
    .option('--to <date>', 'issue date to (YYYY-MM-DD)')
    .option('--counterparty-cif <cif>', 'filter by counterparty CUI')
    .option('--company-id <uuid>', 'filter by company')
    .option('--limit <n>', 'page size (max 100)')
    .option('--cursor <cursor>', 'cursor from a previous page')
    .action((opts: LsOpts) => fastbillLs(deps, opts));

  withConn(fastbill.command('download <id>').description('Download invoice files'))
    .option('--kind <kind>', 'xml | zip | pdf (default zip)')
    .option('--out <path>', 'output file (stdout when omitted)')
    .action((id: string, opts: DownloadOpts) => fastbillDownload(deps, id, opts));

  withConn(fastbill.command('validate').description('Build + validate without creating (not quota-counted)'))
    .option('--company-id <uuid>', 'supplier company id')
    .option('--number <number>', 'invoice number')
    .option('--issue-date <date>', 'issue date (YYYY-MM-DD)')
    .option('--due-date <date>', 'due date (YYYY-MM-DD)')
    .option('--customer-cui <cui>', 'customer CUI')
    .option('--line <line>', 'invoice line "desc|qty|price|tax[|unitCode]" (repeatable)', collect, [])
    .option('--currency <code>', 'ISO currency (default RON)')
    .action((opts: CreateOpts) => fastbillValidate(deps, opts));
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}
