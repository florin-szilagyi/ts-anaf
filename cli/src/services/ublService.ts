import { UblBuilder, companyToParty, mergePartyOverride } from '@florinszilagyi/anaf-ts-sdk';
import type { InvoiceInput, InvoiceLine } from '@florinszilagyi/anaf-ts-sdk';
import { CliError } from '../output/errors';
import type { UblBuildAction, InvoiceLineAction, PartyOverride } from '../actions';
import type { CompanyService, ConfigStore } from '../state';
import type { LookupService } from './lookupService';

// CIUS-RO address helpers now live in the SDK; re-exported for existing consumers/tests.
export { countyFromAddress, bucharestSectorFromAddress } from '@florinszilagyi/anaf-ts-sdk';

export interface UblServiceOptions {
  companyService: CompanyService;
  configStore: ConfigStore;
  lookupService: LookupService;
  builder?: UblBuilder;
}

export interface UblBuildResult {
  xml: string;
  invoice: InvoiceInput;
}

export class UblService {
  private readonly companyService: CompanyService;
  private readonly configStore: ConfigStore;
  private readonly lookupService: LookupService;
  private readonly builder: UblBuilder;

  constructor(opts: UblServiceOptions) {
    this.companyService = opts.companyService;
    this.configStore = opts.configStore;
    this.lookupService = opts.lookupService;
    this.builder = opts.builder ?? new UblBuilder();
  }

  async buildFromAction(action: UblBuildAction): Promise<UblBuildResult> {
    // Resolve the active company CUI — the action.context field is now the CUI
    // of the supplier company (either from the active company or an override).
    const supplierCui = action.context;

    const [supplierLookup, customerLookup] = await Promise.all([
      this.lookupService.getCompany(supplierCui),
      this.lookupService.getCompany(action.invoice.customerCui),
    ]);

    const supplier = mergePartyOverride(
      companyToParty(supplierLookup, supplierCui),
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
      taxCurrencyTaxAmount: action.invoice.taxCurrencyTaxAmount,
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
