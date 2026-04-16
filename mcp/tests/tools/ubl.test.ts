import { describe, it, expect, jest } from '@jest/globals';
import { handleBuildUbl } from '../../src/tools/ubl.js';
import { UblBuilder } from '@florinszilagyi/anaf-ts-sdk';

describe('handleBuildUbl', () => {
  it('generates UBL XML from a minimal invoice', async () => {
    const input = {
      invoiceNumber: 'INV-001',
      issueDate: '2026-04-16',
      currency: 'RON',
      supplier: {
        registrationName: 'Acme SRL',
        companyId: '12345678',
        vatNumber: 'RO12345678',
        address: {
          street: 'Str. Test 1',
          city: 'Cluj-Napoca',
          postalZone: '400001',
          county: 'RO-CJ',
          countryCode: 'RO',
        },
      },
      customer: {
        registrationName: 'Beta SRL',
        companyId: '87654321',
        address: {
          street: 'Str. Demo 2',
          city: 'Bucuresti',
          postalZone: '010001',
          county: 'RO-B',
          countryCode: 'RO',
        },
      },
      lines: [{ description: 'Consultanta', quantity: 1, unitPrice: 100, taxPercent: 21 }],
      isSupplierVatPayer: true,
    };
    const result = await handleBuildUbl(input, { builder: new UblBuilder() });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('<?xml');
    expect(result.content[0].text).toContain('INV-001');
    expect(result.content[0].text).toContain('Acme SRL');
  });

  it('returns error when builder throws', async () => {
    const mockBuilder = {
      generateInvoiceXml: jest.fn<() => string>().mockImplementation(() => {
        throw new Error('missing lines');
      }),
    };
    const result = await handleBuildUbl(
      {
        invoiceNumber: 'INV-002',
        issueDate: '2026-04-16',
        supplier: {
          registrationName: 'X',
          companyId: '1',
          address: { street: '-', city: '-', postalZone: '-', countryCode: 'RO' },
        },
        customer: {
          registrationName: 'Y',
          companyId: '2',
          address: { street: '-', city: '-', postalZone: '-', countryCode: 'RO' },
        },
        lines: [],
      },
      { builder: mockBuilder as any }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/UBL_BUILD_FAILED|missing lines/);
  });
});
