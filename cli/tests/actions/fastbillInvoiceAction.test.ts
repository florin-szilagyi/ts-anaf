import { normalizeFastbillInvoiceAction } from '../../src/actions';
import { CliError } from '../../src/output/errors';

const VALID = {
  companyId: 'a0000000-0000-4000-8000-000000000001',
  invoiceNumber: 'FB-1',
  issueDate: '2026-07-01',
  customerCui: 'RO12345678',
  lines: ['Consulting|2|100|19'],
};

describe('normalizeFastbillInvoiceAction', () => {
  it('normalizes pipe-string lines', () => {
    const action = normalizeFastbillInvoiceAction(VALID);
    expect(action.kind).toBe('fastbill.invoice');
    expect(action.invoice.lines).toEqual([{ description: 'Consulting', quantity: 2, unitPrice: 100, taxPercent: 19 }]);
  });

  it('accepts structured lines and passthrough fields', () => {
    const action = normalizeFastbillInvoiceAction({
      ...VALID,
      lines: [{ description: 'x', quantity: 1, unitPrice: 5, taxPercent: 9, unitCode: 'H87' }],
      idempotencyKey: 'job-42',
      wait: true,
      timeoutMinutes: 5,
      note: 'thanks',
    });
    expect(action.invoice.lines[0].unitCode).toBe('H87');
    expect(action.idempotencyKey).toBe('job-42');
    expect(action.wait).toBe(true);
    expect(action.timeoutMinutes).toBe(5);
    expect(action.invoice.note).toBe('thanks');
  });

  it.each([
    ['bad companyId', { ...VALID, companyId: 'not-a-uuid' }],
    ['bad date', { ...VALID, issueDate: '01-07-2026' }],
    ['bad cui', { ...VALID, customerCui: 'DE9' }],
    ['no lines', { ...VALID, lines: [] }],
    ['unknown field', { ...VALID, surprise: 1 }],
  ])('rejects %s with INVALID_FASTBILL_INPUT', (_label, input) => {
    try {
      normalizeFastbillInvoiceAction(input as never);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe('INVALID_FASTBILL_INPUT');
      expect((e as CliError).category).toBe('user_input');
    }
  });

  it('rejects malformed pipe lines with INVALID_LINE', () => {
    try {
      normalizeFastbillInvoiceAction({ ...VALID, lines: ['only|two'] });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CliError).code).toBe('INVALID_LINE');
    }
  });
});
