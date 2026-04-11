import { UblBuilder } from 'anaf-ts-sdk';
import type { AnafCompanyData, InvoiceInput, InvoiceLine, Party } from 'anaf-ts-sdk';
import { CliError } from '../output/errors';
import type { UblBuildAction, InvoiceLineAction, PartyOverride } from '../actions';
import { mergePartyOverride } from '../actions/overrideMerge';
import type { ContextService } from '../state';
import type { LookupService } from './lookupService';

export interface UblServiceOptions {
  contextService: ContextService;
  lookupService: LookupService;
  builder?: UblBuilder;
}

export interface UblBuildResult {
  xml: string;
  invoice: InvoiceInput;
}

export class UblService {
  private readonly contextService: ContextService;
  private readonly lookupService: LookupService;
  private readonly builder: UblBuilder;

  constructor(opts: UblServiceOptions) {
    this.contextService = opts.contextService;
    this.lookupService = opts.lookupService;
    this.builder = opts.builder ?? new UblBuilder();
  }

  async buildFromAction(action: UblBuildAction): Promise<UblBuildResult> {
    const context = this.contextService.resolve(action.context);

    const [supplierLookup, customerLookup] = await Promise.all([
      this.lookupService.getCompany(context.companyCui),
      this.lookupService.getCompany(action.invoice.customerCui),
    ]);

    const supplier = mergePartyOverride(
      companyToParty(supplierLookup, context.companyCui),
      action.invoice.overrides?.supplier as PartyOverride | undefined
    );
    const customer = mergePartyOverride(
      companyToParty(customerLookup, action.invoice.customerCui),
      action.invoice.overrides?.customer as PartyOverride | undefined
    );

    const invoice: InvoiceInput = {
      invoiceNumber: action.invoice.invoiceNumber,
      issueDate: action.invoice.issueDate,
      dueDate: action.invoice.dueDate ?? action.invoice.overrides?.dueDate,
      currency: action.invoice.currency ?? action.invoice.overrides?.currency ?? 'RON',
      note: action.invoice.note ?? action.invoice.overrides?.note,
      supplier,
      customer,
      lines: action.invoice.lines.map(toInvoiceLine),
      paymentIban: action.invoice.paymentIban ?? action.invoice.overrides?.paymentIban,
      isSupplierVatPayer: supplier.vatNumber !== undefined,
    };

    let xml: string;
    try {
      xml = this.builder.generateInvoiceXml(invoice);
    } catch (cause) {
      throw new CliError({
        code: 'UBL_BUILD_FAILED',
        message: `Failed to build UBL XML: ${(cause as Error).message}`,
        category: 'generic',
        details: { invoiceNumber: invoice.invoiceNumber },
      });
    }

    return { xml, invoice };
  }
}

// The SDK's UblBuilder hard-validates non-empty street / city / postalZone
// (see InvoiceBuilder.validateAddress). ANAF's public lookup returns the
// whole address as a single monolithic string and does not break out a city
// field, so we must synthesize placeholders that pass SDK validation but
// remain trivially overridable. `'-'` is short, obviously-a-placeholder, and
// survives `value?.trim()` checks. Real-world callers who need a clean XML
// supply --customer-city / --supplier-city overrides (or the `overrides.*`
// block on a manifest) and the merge wins over this default.
const ADDRESS_PLACEHOLDER = '-';

function companyToParty(company: AnafCompanyData, fallbackCui: string): Party {
  const cui = company.vatCode ?? fallbackCui.replace(/^RO/i, '');
  const vatNumber = company.scpTva ? `RO${cui}` : undefined;
  const street = company.address?.trim() ? company.address : ADDRESS_PLACEHOLDER;
  const postalZone = company.postalCode?.trim() ? company.postalCode : ADDRESS_PLACEHOLDER;
  return {
    registrationName: company.name,
    companyId: cui,
    vatNumber,
    address: {
      street,
      city: ADDRESS_PLACEHOLDER,
      postalZone,
      countryCode: 'RO',
    },
    telephone: company.contactPhone || undefined,
  };
}

function toInvoiceLine(line: InvoiceLineAction): InvoiceLine {
  const out: InvoiceLine = {
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    taxPercent: line.taxPercent,
  };
  if (line.unitCode) out.unitCode = line.unitCode;
  return out;
}
