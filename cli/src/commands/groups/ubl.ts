import fs from 'node:fs';
import type { Command } from 'commander';
import { parse as parseYaml } from 'yaml';
import type { CommandDeps } from '../buildProgram';
import { CliError } from '../../output/errors';
import { renderSuccess } from '../../output';
import { kv } from '../../output/format';
import { normalizeUblBuildAction, type UblBuildInput } from '../../actions';

interface UblBuildCmdOpts {
  invoiceNumber?: string;
  issueDate?: string;
  dueDate?: string;
  customerCui?: string;
  line?: string[];
  currency?: string;
  taxCurrencyTaxAmount?: string;
  paymentIban?: string;
  note?: string;
  out?: string;
  fromJson?: string;
  fromYaml?: string;
  // supplier overrides
  supplierName?: string;
  supplierStreet?: string;
  supplierCity?: string;
  supplierPostalZone?: string;
  supplierCountryCode?: string;
  // customer overrides
  customerName?: string;
  customerStreet?: string;
  customerCity?: string;
  customerPostalZone?: string;
  customerCountryCode?: string;
}

interface UblInspectCmdOpts {
  xml?: string;
}

function pruneUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

function buildOverridesFromFlags(opts: UblBuildCmdOpts): UblBuildInput['overrides'] {
  const supplierAddress: Record<string, string | undefined> = {
    street: opts.supplierStreet,
    city: opts.supplierCity,
    postalZone: opts.supplierPostalZone,
    countryCode: opts.supplierCountryCode,
  };
  const customerAddress: Record<string, string | undefined> = {
    street: opts.customerStreet,
    city: opts.customerCity,
    postalZone: opts.customerPostalZone,
    countryCode: opts.customerCountryCode,
  };
  const hasSupplierAddress = Object.values(supplierAddress).some((v) => v !== undefined);
  const hasCustomerAddress = Object.values(customerAddress).some((v) => v !== undefined);
  const hasSupplier = opts.supplierName !== undefined || hasSupplierAddress;
  const hasCustomer = opts.customerName !== undefined || hasCustomerAddress;
  if (!hasSupplier && !hasCustomer) return undefined;

  const overrides: NonNullable<UblBuildInput['overrides']> = {};
  if (hasSupplier) {
    overrides.supplier = {
      ...(opts.supplierName !== undefined ? { registrationName: opts.supplierName } : {}),
      ...(hasSupplierAddress ? { address: pruneUndefined(supplierAddress) } : {}),
    };
  }
  if (hasCustomer) {
    overrides.customer = {
      ...(opts.customerName !== undefined ? { registrationName: opts.customerName } : {}),
      ...(hasCustomerAddress ? { address: pruneUndefined(customerAddress) } : {}),
    };
  }
  return overrides;
}

function loadInputFile(fromJson?: string, fromYaml?: string): UblBuildInput | undefined {
  if (fromJson) {
    const raw = fs.readFileSync(fromJson, 'utf8');
    try {
      return JSON.parse(raw) as UblBuildInput;
    } catch (cause) {
      throw new CliError({
        code: 'INVALID_INVOICE_INPUT',
        message: `failed to parse --from-json file: ${(cause as Error).message}`,
        category: 'user_input',
        details: { path: fromJson },
      });
    }
  }
  if (fromYaml) {
    const raw = fs.readFileSync(fromYaml, 'utf8');
    try {
      return parseYaml(raw) as UblBuildInput;
    } catch (cause) {
      throw new CliError({
        code: 'INVALID_INVOICE_INPUT',
        message: `failed to parse --from-yaml file: ${(cause as Error).message}`,
        category: 'user_input',
        details: { path: fromYaml },
      });
    }
  }
  return undefined;
}

/**
 * Resolve the active company CUI to use as the supplier context.
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

function buildInputFromFlags(opts: UblBuildCmdOpts, supplierCui: string): UblBuildInput {
  const missing: string[] = [];
  if (!opts.invoiceNumber) missing.push('--invoice-number');
  if (!opts.issueDate) missing.push('--issue-date');
  if (!opts.customerCui) missing.push('--customer-cui');
  if (!opts.line || opts.line.length === 0) missing.push('--line');
  if (missing.length > 0) {
    throw new CliError({
      code: 'BAD_USAGE',
      message: `ubl build: missing required options: ${missing.join(', ')}`,
      category: 'user_input',
      details: { missing },
    });
  }
  return {
    context: supplierCui,
    invoiceNumber: opts.invoiceNumber!,
    issueDate: opts.issueDate!,
    dueDate: opts.dueDate,
    customerCui: opts.customerCui!,
    lines: opts.line!,
    currency: opts.currency,
    taxCurrencyTaxAmount: opts.taxCurrencyTaxAmount !== undefined ? parseFloat(opts.taxCurrencyTaxAmount) : undefined,
    paymentIban: opts.paymentIban,
    note: opts.note,
    overrides: buildOverridesFromFlags(opts),
    output: opts.out ? { mode: 'file', path: opts.out } : undefined,
  };
}

export async function ublBuild(deps: CommandDeps, opts: UblBuildCmdOpts): Promise<void> {
  const supplierCui = resolveActiveCui(deps);

  const fromFile = loadInputFile(opts.fromJson, opts.fromYaml);
  if (fromFile) {
    const hasFlags =
      opts.invoiceNumber !== undefined ||
      opts.issueDate !== undefined ||
      opts.customerCui !== undefined ||
      (opts.line !== undefined && opts.line.length > 0);
    if (hasFlags) {
      throw new CliError({
        code: 'BAD_USAGE',
        message: 'ubl build: --from-json / --from-yaml cannot be combined with flag-based input',
        category: 'user_input',
      });
    }
  }

  const input = fromFile ?? buildInputFromFlags(opts, supplierCui);

  // When loading from a file, use the active company CUI as context
  if (fromFile) {
    input.context = supplierCui;
  }
  // Honor --out even when loading from file
  if (opts.out) {
    input.output = { mode: 'file', path: opts.out };
  }

  const action = normalizeUblBuildAction(input);
  const result = await deps.services.ublService.buildFromAction(action);

  const xmlPath = action.output.mode === 'file' ? (action.output.path ?? null) : null;

  if (deps.output.format !== 'text') {
    const data = {
      invoiceNumber: action.invoice.invoiceNumber,
      xmlLength: result.xml.length,
      xmlPath,
      xml: result.xml,
    };
    renderSuccess(deps.output, data);
    if (xmlPath) {
      fs.writeFileSync(xmlPath, result.xml, 'utf8');
    }
    return;
  }

  // Text mode
  if (xmlPath) {
    fs.writeFileSync(xmlPath, result.xml, 'utf8');
    deps.output.streams.stderr.write(`wrote ${xmlPath}\n`);
    return;
  }

  deps.output.streams.stdout.write(result.xml);
  if (!result.xml.endsWith('\n')) {
    deps.output.streams.stdout.write('\n');
  }
}

export async function ublInspect(deps: CommandDeps, opts: UblInspectCmdOpts): Promise<void> {
  if (!opts.xml) {
    throw new CliError({
      code: 'BAD_USAGE',
      message: 'ubl inspect: --xml <path> is required',
      category: 'user_input',
    });
  }
  const raw = fs.readFileSync(opts.xml, 'utf8');
  const rootMatch = raw.match(/<([A-Za-z][A-Za-z0-9:_.-]*)/);
  const firstElements = Array.from(raw.matchAll(/<([A-Za-z][A-Za-z0-9:_.-]*)/g))
    .slice(0, 10)
    .map((m) => m[1]);
  const data = {
    path: opts.xml,
    size: raw.length,
    rootElement: rootMatch?.[1] ?? null,
    firstElementNames: firstElements,
  };
  renderSuccess(deps.output, data, (d) =>
    kv([
      ['Path', d.path],
      ['Size', String(d.size)],
      ['Root element', d.rootElement ?? '(none)'],
      ['First elements', d.firstElementNames.join(', ')],
    ])
  );
}

function collectLine(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export function registerUbl(parent: Command, deps: CommandDeps): void {
  const ubl = parent.command('ubl').description('UBL invoice authoring');

  ubl
    .command('build')
    .description('Build a UBL invoice from flags or a structured input file')
    .option('--invoice-number <n>', 'invoice number')
    .option('--issue-date <date>', 'issue date (YYYY-MM-DD)')
    .option('--due-date <date>', 'due date (YYYY-MM-DD)')
    .option('--customer-cui <cui>', 'customer CUI')
    .option('--line <line>', 'invoice line: "desc|qty|unitPrice|taxPct[|unitCode]"', collectLine, [] as string[])
    .option('--currency <code>', 'currency code')
    .option(
      '--tax-currency-tax-amount <amount>',
      'total VAT in RON (required when --currency is not RON, CIUS-RO BR-53)'
    )
    .option('--payment-iban <iban>', 'payment IBAN')
    .option('--note <text>', 'free-form note')
    .option('--out <path>', 'output XML file path')
    .option('--from-json <path>', 'load invoice from a JSON file')
    .option('--from-yaml <path>', 'load invoice from a YAML file')
    // supplier overrides
    .option('--supplier-name <name>', 'supplier registration name override')
    .option('--supplier-street <street>', 'supplier street override')
    .option('--supplier-city <city>', 'supplier city override')
    .option('--supplier-postal-zone <zone>', 'supplier postal zone override')
    .option('--supplier-country-code <code>', 'supplier country code override')
    // customer overrides
    .option('--customer-name <name>', 'customer registration name override')
    .option('--customer-street <street>', 'customer street override')
    .option('--customer-city <city>', 'customer city override')
    .option('--customer-postal-zone <zone>', 'customer postal zone override')
    .option('--customer-country-code <code>', 'customer country code override')
    .action((opts: UblBuildCmdOpts) => ublBuild(deps, opts));

  ubl
    .command('inspect')
    .description('Inspect a UBL XML document and emit normalized JSON')
    .option('--xml <path>', 'path to XML file')
    .action((opts: UblInspectCmdOpts) => ublInspect(deps, opts));
}
