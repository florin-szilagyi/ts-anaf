import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UblService } from '../../src/services/ublService';
import { ContextService } from '../../src/state';
import { getXdgPaths } from '../../src/state/paths';
import { CliError } from '../../src/output/errors';
import { normalizeUblBuildAction } from '../../src/actions/ublBuildAction';
import type { Context } from '../../src/state';
import type { AnafCompanyData } from 'anaf-ts-sdk';

function freshPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-ubl-'));
  return getXdgPaths({
    configHome: path.join(dir, 'config'),
    dataHome: path.join(dir, 'data'),
    cacheHome: path.join(dir, 'cache'),
  });
}

const sampleCtx = (): Context => ({
  name: 'acme-prod',
  companyCui: 'RO12345678',
  environment: 'prod',
  auth: { clientId: 'cid', redirectUri: 'https://localhost/cb' },
});

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
  const contextService = new ContextService({ paths });
  const lookup = new StubLookupService();
  lookup.responses.set('12345678', fakeSupplier);
  lookup.responses.set('87654321', fakeCustomer);
  const service = new UblService({
    contextService,
    lookupService: lookup as never,
  });
  return { paths, contextService, lookup, service };
}

describe('UblService.buildFromAction', () => {
  it('hydrates supplier from context CUI and customer from action CUI', async () => {
    const h = harness();
    h.contextService.add(sampleCtx());
    h.contextService.setCurrent('acme-prod');
    const action = normalizeUblBuildAction({
      context: 'acme-prod',
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
    h.contextService.add(sampleCtx());
    h.contextService.setCurrent('acme-prod');
    const action = normalizeUblBuildAction({
      context: 'acme-prod',
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
    h.contextService.add(sampleCtx());
    h.contextService.setCurrent('acme-prod');
    const action = normalizeUblBuildAction({
      context: 'acme-prod',
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
    h.contextService.add(sampleCtx());
    h.contextService.setCurrent('acme-prod');
    const action = normalizeUblBuildAction({
      context: 'acme-prod',
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
    h.contextService.add(sampleCtx());
    h.contextService.setCurrent('acme-prod');
    const action = normalizeUblBuildAction({
      context: 'acme-prod',
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
    h.contextService.add(sampleCtx());
    h.contextService.setCurrent('acme-prod');
    const action = normalizeUblBuildAction({
      context: 'acme-prod',
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
    h.contextService.add(sampleCtx());
    h.contextService.setCurrent('acme-prod');
    const action = normalizeUblBuildAction({
      context: 'acme-prod',
      invoiceNumber: 'FCT-7',
      issueDate: '2026-04-11',
      customerCui: 'RO99999999', // not in stub
      lines: ['x|1|100|19'],
    });
    await expect(h.service.buildFromAction(action)).rejects.toBeInstanceOf(CliError);
  });

  it('wraps UblBuilder failures as UBL_BUILD_FAILED', async () => {
    const paths = freshPaths();
    const contextService = new ContextService({ paths });
    contextService.add(sampleCtx());
    contextService.setCurrent('acme-prod');
    const lookup = new StubLookupService();
    lookup.responses.set('12345678', fakeSupplier);
    lookup.responses.set('87654321', fakeCustomer);
    const brokenBuilder = {
      generateInvoiceXml: (): string => {
        throw new Error('synthetic builder failure');
      },
    };
    const service = new UblService({
      contextService,
      lookupService: lookup as never,
      builder: brokenBuilder as never,
    });
    const action = normalizeUblBuildAction({
      context: 'acme-prod',
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
});
