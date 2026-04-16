import { UblBuilder } from '@florinszilagyi/anaf-ts-sdk';
import type { AnafCompanyData, InvoiceInput, InvoiceLine, Party } from '@florinszilagyi/anaf-ts-sdk';
import { CliError } from '../output/errors';
import type { UblBuildAction, InvoiceLineAction, PartyOverride } from '../actions';
import { mergePartyOverride } from '../actions/overrideMerge';
import type { CompanyService, ConfigStore } from '../state';
import type { LookupService } from './lookupService';

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

const ADDRESS_PLACEHOLDER = '-';

/**
 * Maps ANAF county names (as they appear in address strings) to ISO 3166-2:RO codes.
 * Keys are uppercase ASCII (diacritics stripped via NFD normalization).
 */
const COUNTY_NAME_TO_ISO: Readonly<Record<string, string>> = {
  ALBA: 'RO-AB',
  ARGES: 'RO-AG',
  ARAD: 'RO-AR',
  BACAU: 'RO-BC',
  BIHOR: 'RO-BH',
  'BISTRITA-NASAUD': 'RO-BN',
  BRAILA: 'RO-BR',
  BOTOSANI: 'RO-BT',
  BRASOV: 'RO-BV',
  BUZAU: 'RO-BZ',
  CLUJ: 'RO-CJ',
  CALARASI: 'RO-CL',
  'CARAS-SEVERIN': 'RO-CS',
  CONSTANTA: 'RO-CT',
  COVASNA: 'RO-CV',
  DAMBOVITA: 'RO-DB',
  DOLJ: 'RO-DJ',
  GORJ: 'RO-GJ',
  GALATI: 'RO-GL',
  GIURGIU: 'RO-GR',
  HUNEDOARA: 'RO-HD',
  HARGHITA: 'RO-HR',
  ILFOV: 'RO-IF',
  IALOMITA: 'RO-IL',
  IASI: 'RO-IS',
  MEHEDINTI: 'RO-MH',
  MARAMURES: 'RO-MM',
  MURES: 'RO-MS',
  NEAMT: 'RO-NT',
  OLT: 'RO-OT',
  PRAHOVA: 'RO-PH',
  SIBIU: 'RO-SB',
  SALAJ: 'RO-SJ',
  'SATU MARE': 'RO-SM',
  SUCEAVA: 'RO-SV',
  TULCEA: 'RO-TL',
  TIMIS: 'RO-TM',
  TELEORMAN: 'RO-TR',
  VALCEA: 'RO-VL',
  VRANCEA: 'RO-VN',
  VASLUI: 'RO-VS',
};

/**
 * Normalize a Romanian string for county matching: uppercase + strip diacritics.
 * Handles both cedilla (Ş/Ţ) and comma-below (Ș/Ț) variants via NFD decomposition.
 */
function normalizeRo(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

/**
 * Extract the ISO 3166-2:RO county code from an ANAF-formatted address string.
 *
 * ANAF address format examples:
 *   "JUD. CLUJ, MUN. CLUJ-NAPOCA, STR. MIHAI EMINESCU, NR. 1"
 *   "MUN. BUCURESTI, SECTOR 1, STR. VICTORIEI, NR. 10"
 *   "SECTOR 3, STR. UNIRII, NR. 5"  (Bucharest sector)
 */
function countyFromAddress(address: string | undefined): string | undefined {
  if (!address?.trim()) return undefined;
  const norm = normalizeRo(address);

  // "JUD. <COUNTY>[,...]" — county-based addresses
  const judMatch = norm.match(/^JUD\.\s+([^,]+)/);
  if (judMatch) {
    const countyName = judMatch[1].trim();
    return COUNTY_NAME_TO_ISO[countyName] ?? undefined;
  }

  // Bucharest: "MUN. BUCURESTI..." or "SECTOR X..."
  if (/^MUN\.\s+BUCURESTI/.test(norm) || /^SECTOR\s+\d/.test(norm)) {
    return 'RO-B';
  }

  return undefined;
}

function companyToParty(company: AnafCompanyData, fallbackCui: string): Party {
  const cui = company.vatCode ?? fallbackCui.replace(/^RO/i, '');
  const vatNumber = company.scpTva ? `RO${cui}` : undefined;
  const street = company.address?.trim() ? company.address : ADDRESS_PLACEHOLDER;
  const postalZone = company.postalCode?.trim() ? company.postalCode : ADDRESS_PLACEHOLDER;
  const county = countyFromAddress(company.address);
  return {
    registrationName: company.name,
    companyId: cui,
    vatNumber,
    address: {
      street,
      city: ADDRESS_PLACEHOLDER,
      postalZone,
      county,
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
