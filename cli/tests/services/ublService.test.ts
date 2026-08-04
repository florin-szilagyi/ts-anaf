import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UblService, bucharestSectorFromAddress, countyFromAddress } from '../../src/services/ublService';
import { CompanyService, ConfigStore } from '../../src/state';
import { getXdgPaths } from '../../src/state/paths';
import { CliError } from '../../src/output/errors';
import { normalizeUblBuildAction } from '../../src/actions/ublBuildAction';
import type { AnafCompanyData } from '@florinszilagyi/anaf-ts-sdk';

function freshPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-ubl-'));
  return getXdgPaths({
    configHome: path.join(dir, 'config'),
    dataHome: path.join(dir, 'data'),
    cacheHome: path.join(dir, 'cache'),
  });
}

const fakeSupplier: AnafCompanyData = {
  vatCode: '12345678',
  name: 'Acme SRL',
  registrationNumber: 'J40/1/2020',
  address: 'Bucuresti, Strada A nr 1',
  postalCode: '012345',
  contactPhone: '021-1',
  scpTva: true,
};

const fakeCustomer: AnafCompanyData = {
  vatCode: '87654321',
  name: 'Beta SRL',
  registrationNumber: 'J12/2/2019',
  address: 'Cluj, Strada B nr 2',
  postalCode: '400000',
  contactPhone: '0264-2',
  scpTva: false,
};

class StubLookupService {
  calls: string[] = [];
  responses = new Map<string, AnafCompanyData>();
  async getCompany(cui: string): Promise<AnafCompanyData> {
    this.calls.push(cui);
    const normalized = cui.toUpperCase().replace(/^RO/, '');
    const match = this.responses.get(normalized);
    if (!match) {
      throw new CliError({
        code: 'LOOKUP_NOT_FOUND',
        message: `no company for ${cui}`,
        category: 'anaf_api',
      });
    }
    return match;
  }
  async batchGetCompanies(): Promise<AnafCompanyData[]> {
    throw new Error('not used');
  }
  async getCompanyAsync(): Promise<AnafCompanyData> {
    throw new Error('not used');
  }
  async validateCui(): Promise<boolean> {
    return true;
  }
  invalidate(): void {}
}

function harness() {
  const paths = freshPaths();
  const companyService = new CompanyService({ paths });
  const configStore = new ConfigStore({ paths });
  const lookup = new StubLookupService();
  lookup.responses.set('12345678', fakeSupplier);
  lookup.responses.set('87654321', fakeCustomer);
  const service = new UblService({
    companyService,
    configStore,
    lookupService: lookup as never,
  });
  return { paths, companyService, configStore, lookup, service };
}

describe('UblService.buildFromAction', () => {
  it('hydrates supplier from action context CUI and customer from action CUI', async () => {
    const h = harness();
    // action.context is now the CUI string directly
    const action = normalizeUblBuildAction({
      context: 'RO12345678',
      invoiceNumber: 'FCT-1',
      issueDate: '2026-04-11',
      customerCui: 'RO87654321',
      lines: ['Servicii|1|1000|19'],
    });
    const result = await h.service.buildFromAction(action);
    expect(result.xml).toContain('<?xml');
    expect(result.xml).toContain('FCT-1');
    expect(result.invoice.supplier.registrationName).toBe('Acme SRL');
    expect(result.invoice.customer.registrationName).toBe('Beta SRL');
    // supplier has VAT (scpTva true) → vatNumber set
    expect(result.invoice.supplier.vatNumber).toBe('RO12345678');
    // customer has no VAT → vatNumber undefined
    expect(result.invoice.customer.vatNumber).toBeUndefined();
    // both CUIs were looked up
    expect(h.lookup.calls.sort()).toEqual(['RO12345678', 'RO87654321']);
  });

  it('applies customer overrides on top of the hydrated party', async () => {
    const h = harness();
    const action = normalizeUblBuildAction({
      context: 'RO12345678',
      invoiceNumber: 'FCT-2',
      issueDate: '2026-04-11',
      customerCui: 'RO87654321',
      lines: ['x|1|100|19'],
      overrides: {
        customer: {
          registrationName: 'Beta Corrected SRL',
          address: { city: 'Cluj-Napoca' },
        },
      },
    });
    const result = await h.service.buildFromAction(action);
    expect(result.invoice.customer.registrationName).toBe('Beta Corrected SRL');
    expect(result.invoice.customer.address.city).toBe('Cluj-Napoca');
    // non-overridden fields preserved from lookup
    expect(result.invoice.customer.address.street).toBe('Cluj, Strada B nr 2');
  });

  it('applies supplier overrides on top of the hydrated party', async () => {
    const h = harness();
    const action = normalizeUblBuildAction({
      context: 'RO12345678',
      invoiceNumber: 'FCT-3',
      issueDate: '2026-04-11',
      customerCui: 'RO87654321',
      lines: ['x|1|100|19'],
      overrides: {
        supplier: {
          address: { city: 'Bucuresti', county: 'B' },
        },
      },
    });
    const result = await h.service.buildFromAction(action);
    expect(result.invoice.supplier.address.city).toBe('Bucuresti');
    expect(result.invoice.supplier.address.county).toBe('B');
  });

  it('defaults currency to RON when neither top-level nor override is set', async () => {
    const h = harness();
    const action = normalizeUblBuildAction({
      context: 'RO12345678',
      invoiceNumber: 'FCT-4',
      issueDate: '2026-04-11',
      customerCui: 'RO87654321',
      lines: ['x|1|100|19'],
    });
    const result = await h.service.buildFromAction(action);
    expect(result.invoice.currency).toBe('RON');
  });

  it('honors explicit currency and paymentIban', async () => {
    const h = harness();
    const action = normalizeUblBuildAction({
      context: 'RO12345678',
      invoiceNumber: 'FCT-5',
      issueDate: '2026-04-11',
      customerCui: 'RO87654321',
      lines: ['x|1|100|19'],
      currency: 'EUR',
      paymentIban: 'RO49AAAA1B31007593840000',
    });
    const result = await h.service.buildFromAction(action);
    expect(result.invoice.currency).toBe('EUR');
    expect(result.invoice.paymentIban).toBe('RO49AAAA1B31007593840000');
  });

  it('maps invoice lines with unitCode', async () => {
    const h = harness();
    const action = normalizeUblBuildAction({
      context: 'RO12345678',
      invoiceNumber: 'FCT-6',
      issueDate: '2026-04-11',
      customerCui: 'RO87654321',
      lines: ['Cabluri|10|5.5|9|MTR'],
    });
    const result = await h.service.buildFromAction(action);
    expect(result.invoice.lines).toHaveLength(1);
    expect(result.invoice.lines[0]).toMatchObject({
      description: 'Cabluri',
      quantity: 10,
      unitPrice: 5.5,
      taxPercent: 9,
      unitCode: 'MTR',
    });
  });

  it('propagates LOOKUP_NOT_FOUND from the lookup service', async () => {
    const h = harness();
    const action = normalizeUblBuildAction({
      context: 'RO12345678',
      invoiceNumber: 'FCT-7',
      issueDate: '2026-04-11',
      customerCui: 'RO99999999', // not in stub
      lines: ['x|1|100|19'],
    });
    await expect(h.service.buildFromAction(action)).rejects.toBeInstanceOf(CliError);
  });

  it('wraps UblBuilder failures as UBL_BUILD_FAILED', async () => {
    const paths = freshPaths();
    const companyService = new CompanyService({ paths });
    const configStore = new ConfigStore({ paths });
    const lookup = new StubLookupService();
    lookup.responses.set('12345678', fakeSupplier);
    lookup.responses.set('87654321', fakeCustomer);
    const brokenBuilder = {
      generateInvoiceXml: (): string => {
        throw new Error('synthetic builder failure');
      },
    };
    const service = new UblService({
      companyService,
      configStore,
      lookupService: lookup as never,
      builder: brokenBuilder as never,
    });
    const action = normalizeUblBuildAction({
      context: 'RO12345678',
      invoiceNumber: 'FCT-8',
      issueDate: '2026-04-11',
      customerCui: 'RO87654321',
      lines: ['x|1|100|19'],
    });
    let err: unknown;
    try {
      await service.buildFromAction(action);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('UBL_BUILD_FAILED');
    expect((err as CliError).category).toBe('generic');
  });

  it('passes taxCurrencyTaxAmount through to the invoice', async () => {
    const paths = freshPaths();
    const configStore = new ConfigStore(paths);
    const companyService = {} as any;
    const lookup = new StubLookupService();
    lookup.responses.set('12345678', fakeSupplier);
    lookup.responses.set('87654321', fakeCustomer);
    const service = new UblService({ companyService, configStore, lookupService: lookup as never });
    const action = normalizeUblBuildAction({
      context: 'RO12345678',
      invoiceNumber: 'FCT-EUR',
      issueDate: '2026-04-13',
      customerCui: 'RO87654321',
      lines: ['Serviciu|1|500|21'],
      currency: 'EUR',
      taxCurrencyTaxAmount: 530.25,
    });
    const result = await service.buildFromAction(action);
    expect(result.invoice.currency).toBe('EUR');
    expect(result.invoice.taxCurrencyTaxAmount).toBe(530.25);
    expect(result.xml).toContain('<cbc:TaxCurrencyCode>RON</cbc:TaxCurrencyCode>');
    expect(result.xml).toContain('<cbc:TaxAmount currencyID="RON">530.25</cbc:TaxAmount>');
  });

  it('passes invoiceTypeCode through to the invoice and the emitted XML', async () => {
    const { service } = harness();
    const action = normalizeUblBuildAction({
      context: 'RO12345678',
      invoiceNumber: 'FCT-TYPE',
      issueDate: '2026-08-04',
      customerCui: 'RO87654321',
      lines: ['Serviciu|1|100|19'],
      invoiceTypeCode: '751',
    });
    const result = await service.buildFromAction(action);
    expect(result.invoice.invoiceTypeCode).toBe('751');
    expect(result.xml).toContain('<cbc:InvoiceTypeCode>751</cbc:InvoiceTypeCode>');
  });

  it('emits the default InvoiceTypeCode 380 when invoiceTypeCode is omitted', async () => {
    const { service } = harness();
    const action = normalizeUblBuildAction({
      context: 'RO12345678',
      invoiceNumber: 'FCT-DEFAULT',
      issueDate: '2026-08-04',
      customerCui: 'RO87654321',
      lines: ['Serviciu|1|100|19'],
    });
    const result = await service.buildFromAction(action);
    expect(result.invoice.invoiceTypeCode).toBeUndefined();
    expect(result.xml).toContain('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>');
  });
});

describe('companyToParty county extraction', () => {
  // We test the county extraction indirectly via UblService — the function is private but
  // its output is observable in the resulting invoice's supplier.address.county field.
  function makeService(supplierAddress: string) {
    const paths = freshPaths();
    const configStore = new ConfigStore(paths);
    const supplier: AnafCompanyData = { ...fakeSupplier, address: supplierAddress };
    const lookup = new StubLookupService();
    lookup.responses.set('12345678', supplier);
    lookup.responses.set('87654321', fakeCustomer);
    return new UblService({ companyService: {} as any, configStore, lookupService: lookup as never });
  }

  async function buildAndGetSupplierCounty(address: string): Promise<string | undefined> {
    const service = makeService(address);
    const paths = freshPaths();
    const configStore = new ConfigStore(paths);
    const lookup = new StubLookupService();
    const supplier: AnafCompanyData = { ...fakeSupplier, address };
    lookup.responses.set('12345678', supplier);
    lookup.responses.set('87654321', fakeCustomer);
    const svc = new UblService({ companyService: {} as any, configStore, lookupService: lookup as never });
    const action = normalizeUblBuildAction({
      context: 'RO12345678',
      invoiceNumber: 'FCT-CTY',
      issueDate: '2026-04-13',
      customerCui: 'RO87654321',
      lines: ['x|1|100|21'],
    });
    const result = await svc.buildFromAction(action);
    return result.invoice.supplier.address.county;
  }

  it('extracts Cluj county from JUD. CLUJ prefix', async () => {
    expect(await buildAndGetSupplierCounty('JUD. CLUJ, MUN. CLUJ-NAPOCA, STR. MIHAI EMINESCU, NR. 1')).toBe('RO-CJ');
  });

  it('extracts Bucharest from MUN. BUCURESTI prefix', async () => {
    expect(await buildAndGetSupplierCounty('MUN. BUCURESTI, SECTOR 1, STR. VICTORIEI, NR. 10')).toBe('RO-B');
  });

  it('extracts Bucharest from MUNICIPIUL BUCURESTI prefix (full word, with diacritics)', async () => {
    // ANAF lookups for Bucharest companies return the full word "MUNICIPIUL BUCUREŞTI".
    // After diacritic stripping that becomes "MUNICIPIUL BUCURESTI" — must be treated as RO-B.
    expect(await buildAndGetSupplierCounty('MUNICIPIUL BUCUREŞTI, SECTOR 1, STR SEMICERCULUI, NR.12, ET.III')).toBe(
      'RO-B'
    );
  });

  it('extracts Bucharest from SECTOR prefix', async () => {
    expect(await buildAndGetSupplierCounty('SECTOR 3, STR. UNIRII, NR. 5')).toBe('RO-B');
  });

  it('handles diacritics in county name (Bistrita-Nasaud)', async () => {
    expect(await buildAndGetSupplierCounty('JUD. BISTRIȚA-NĂSĂUD, BISTRITA, STR. X')).toBe('RO-BN');
  });

  it('returns undefined for unrecognized address format', async () => {
    expect(await buildAndGetSupplierCounty('Strada Necunoscuta nr 1')).toBeUndefined();
  });

  it('returns undefined for empty address', async () => {
    expect(await buildAndGetSupplierCounty('')).toBeUndefined();
  });
});

describe('countyFromAddress (direct)', () => {
  it('matches the full-word "MUNICIPIUL BUCUREŞTI" form returned by ANAF lookups', () => {
    expect(countyFromAddress('MUNICIPIUL BUCUREŞTI, SECTOR 1, STR SEMICERCULUI, NR.12, ET.III')).toBe('RO-B');
  });

  it('still matches the abbreviated "MUN. BUCURESTI" form', () => {
    expect(countyFromAddress('MUN. BUCURESTI, SECTOR 3, STR. UNIRII')).toBe('RO-B');
  });

  it('extracts non-Bucharest county codes from JUD. prefix', () => {
    expect(countyFromAddress('JUD. CLUJ, MUN. CLUJ-NAPOCA, STR. MIKO IMRE, NR.8')).toBe('RO-CJ');
  });
});

describe('bucharestSectorFromAddress', () => {
  it('returns SECTOR1 for the full-word ANAF Bucharest form', () => {
    expect(bucharestSectorFromAddress('MUNICIPIUL BUCUREŞTI, SECTOR 1, STR SEMICERCULUI, NR.12, ET.III')).toBe(
      'SECTOR1'
    );
  });

  it('returns SECTOR3 for the abbreviated MUN. BUCURESTI form', () => {
    expect(bucharestSectorFromAddress('MUN. BUCURESTI, SECTOR 3, STR. UNIRII')).toBe('SECTOR3');
  });

  it('returns undefined for non-Bucharest county addresses', () => {
    expect(bucharestSectorFromAddress('JUD. CLUJ, MUN. CLUJ-NAPOCA, STR. MIKO IMRE, NR.8')).toBeUndefined();
  });

  it('returns undefined when Bucharest address has no SECTOR token', () => {
    // We do not infer a sector when ANAF doesn't include it in the address string.
    expect(bucharestSectorFromAddress('MUNICIPIUL BUCURESTI, BD. UNIRII, NR. 1')).toBeUndefined();
  });

  it('returns undefined for an out-of-range sector number', () => {
    // RO-B has sectors 1..6 only.
    expect(bucharestSectorFromAddress('MUN. BUCURESTI, SECTOR 7, STR. X')).toBeUndefined();
  });

  it('returns undefined for an empty address', () => {
    expect(bucharestSectorFromAddress('')).toBeUndefined();
    expect(bucharestSectorFromAddress(undefined)).toBeUndefined();
  });
});

describe('companyToParty Bucharest sector derivation (BR-RO-100)', () => {
  // We exercise the integration from ANAF lookup → invoice supplier.address — the
  // county must be RO-B and the city must be auto-derived to SECTORn.
  async function buildAndGetSupplierAddress(address: string) {
    const paths = freshPaths();
    const configStore = new ConfigStore(paths);
    const supplier: AnafCompanyData = { ...fakeSupplier, address };
    const lookup = new StubLookupService();
    lookup.responses.set('12345678', supplier);
    lookup.responses.set('87654321', fakeCustomer);
    const svc = new UblService({
      companyService: {} as never,
      configStore,
      lookupService: lookup as never,
    });
    const action = normalizeUblBuildAction({
      context: 'RO12345678',
      invoiceNumber: 'FCT-SEC',
      issueDate: '2026-05-08',
      customerCui: 'RO87654321',
      lines: ['x|1|100|19'],
    });
    const result = await svc.buildFromAction(action);
    return result.invoice.supplier.address;
  }

  it('derives city=SECTOR1 from a MUNICIPIUL BUCUREŞTI ANAF address', async () => {
    const address = await buildAndGetSupplierAddress('MUNICIPIUL BUCUREŞTI, SECTOR 1, STR SEMICERCULUI, NR.12, ET.III');
    expect(address.county).toBe('RO-B');
    expect(address.city).toBe('SECTOR1');
  });

  it('derives city=SECTOR3 from a MUN. BUCURESTI ANAF address', async () => {
    const address = await buildAndGetSupplierAddress('MUN. BUCURESTI, SECTOR 3, STR. UNIRII');
    expect(address.county).toBe('RO-B');
    expect(address.city).toBe('SECTOR3');
  });

  it('keeps the placeholder city for non-Bucharest counties', async () => {
    const address = await buildAndGetSupplierAddress('JUD. CLUJ, MUN. CLUJ-NAPOCA, STR. MIKO IMRE, NR.8');
    expect(address.county).toBe('RO-CJ');
    expect(address.city).toBe('-');
  });

  it('falls back to placeholder when Bucharest address has no SECTOR token', async () => {
    const address = await buildAndGetSupplierAddress('MUNICIPIUL BUCURESTI, BD. UNIRII, NR. 1');
    expect(address.county).toBe('RO-B');
    expect(address.city).toBe('-');
  });
});
