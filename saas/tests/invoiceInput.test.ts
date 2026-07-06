import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/errors';
import { parseCreateInvoice } from '@/lib/validation/invoiceInput';

const VALID = {
  companyId: '8f14e45f-ceea-4670-8f14-e45fceea4670',
  invoiceNumber: 'FB-0001',
  issueDate: '2026-07-01',
  customerCui: 'RO12345678',
  lines: [{ description: 'Consulting', quantity: 2, unitPrice: 100, taxPercent: 19 }],
};

describe('createInvoiceSchema', () => {
  it('accepts a minimal valid payload', () => {
    const parsed = parseCreateInvoice(VALID);
    expect(parsed.currency).toBeUndefined();
    expect(parsed.lines[0].taxPercent).toBe(19);
  });

  it('defaults taxPercent to 0', () => {
    const parsed = parseCreateInvoice({
      ...VALID,
      lines: [{ description: 'x', quantity: 1, unitPrice: 5 }],
    });
    expect(parsed.lines[0].taxPercent).toBe(0);
  });

  it.each([
    ['bad companyId', { ...VALID, companyId: 'nope' }],
    ['bad date', { ...VALID, issueDate: '01-07-2026' }],
    ['bad cui', { ...VALID, customerCui: 'DE999' }],
    ['no lines', { ...VALID, lines: [] }],
    ['negative price', { ...VALID, lines: [{ description: 'x', quantity: 1, unitPrice: -5, taxPercent: 0 }] }],
    ['zero quantity', { ...VALID, lines: [{ description: 'x', quantity: 0, unitPrice: 5, taxPercent: 0 }] }],
    ['unknown field', { ...VALID, surprise: true }],
    ['tax > 100', { ...VALID, lines: [{ description: 'x', quantity: 1, unitPrice: 5, taxPercent: 120 }] }],
  ])('rejects %s', (_label, payload) => {
    expect(() => parseCreateInvoice(payload)).toThrowError(ApiError);
    try {
      parseCreateInvoice(payload);
    } catch (e) {
      expect((e as ApiError).code).toBe('INVALID_INVOICE_INPUT');
      expect((e as ApiError).status).toBe(422);
    }
  });

  it('accepts party overrides', () => {
    const parsed = parseCreateInvoice({
      ...VALID,
      overrides: { customer: { address: { postalZone: '010101' } } },
    });
    expect(parsed.overrides?.customer?.address?.postalZone).toBe('010101');
  });
});
