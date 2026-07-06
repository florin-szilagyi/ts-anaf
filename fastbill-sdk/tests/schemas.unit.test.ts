import { createInvoiceSchema } from '../src';

const VALID = {
  companyId: 'a0000000-0000-4000-8000-000000000001',
  invoiceNumber: 'FB-1',
  issueDate: '2026-07-01',
  customerCui: 'RO123456',
  lines: [{ description: 'x', quantity: 1, unitPrice: 10, taxPercent: 19 }],
};

describe('createInvoiceSchema (API contract)', () => {
  it('accepts a minimal payload and defaults taxPercent', () => {
    const parsed = createInvoiceSchema.parse({
      ...VALID,
      lines: [{ description: 'x', quantity: 1, unitPrice: 10 }],
    });
    expect(parsed.lines[0].taxPercent).toBe(0);
  });

  it.each([
    ['bad uuid', { ...VALID, companyId: 'nope' }],
    ['bad date', { ...VALID, issueDate: '2026/07/01' }],
    ['bad cui', { ...VALID, customerCui: 'DE99' }],
    ['empty lines', { ...VALID, lines: [] }],
    ['zero quantity', { ...VALID, lines: [{ description: 'x', quantity: 0, unitPrice: 1 }] }],
    ['unknown key', { ...VALID, extra: 1 }],
  ])('rejects %s', (_label, payload) => {
    expect(createInvoiceSchema.safeParse(payload).success).toBe(false);
  });

  it('accepts party overrides', () => {
    const parsed = createInvoiceSchema.parse({
      ...VALID,
      overrides: { customer: { address: { postalZone: '010101' } } },
    });
    expect(parsed.overrides?.customer?.address?.postalZone).toBe('010101');
  });
});
