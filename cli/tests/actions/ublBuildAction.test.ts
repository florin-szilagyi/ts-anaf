import { normalizeUblBuildAction, ublBuildInputSchema } from '../../src/actions/ublBuildAction';
import { CliError } from '../../src/output/errors';

describe('ublBuildInputSchema', () => {
  it('accepts a minimal valid input', () => {
    const parsed = ublBuildInputSchema.parse({
      context: 'acme-prod',
      invoiceNumber: 'FCT-1',
      issueDate: '2026-04-11',
      customerCui: 'RO87654321',
      lines: ['Service|1|100|19'],
    });
    expect(parsed.invoiceNumber).toBe('FCT-1');
  });

  it('rejects missing required fields', () => {
    expect(() => ublBuildInputSchema.parse({})).toThrow();
  });
});

describe('normalizeUblBuildAction', () => {
  it('normalizes string lines via parseInvoiceLine', () => {
    const action = normalizeUblBuildAction({
      context: 'acme-prod',
      invoiceNumber: 'FCT-1',
      issueDate: '2026-04-11',
      customerCui: 'RO87654321',
      lines: ['Service|2|50|19', 'Cable|10|5.5|9|MTR'],
    });
    expect(action.kind).toBe('ubl.build');
    expect(action.context).toBe('acme-prod');
    expect(action.invoice.lines).toHaveLength(2);
    expect(action.invoice.lines[1].unitCode).toBe('MTR');
  });

  it('passes object lines through', () => {
    const action = normalizeUblBuildAction({
      context: 'acme-prod',
      invoiceNumber: 'FCT-1',
      issueDate: '2026-04-11',
      customerCui: 'RO87654321',
      lines: [{ description: 'Pre-parsed', quantity: 1, unitPrice: 100, taxPercent: 19 }],
    });
    expect(action.invoice.lines[0].description).toBe('Pre-parsed');
  });

  it('defaults output to stdout when no output is supplied', () => {
    const action = normalizeUblBuildAction({
      context: 'acme-prod',
      invoiceNumber: 'FCT-1',
      issueDate: '2026-04-11',
      customerCui: 'RO87654321',
      lines: ['x|1|1|0'],
    });
    expect(action.output).toEqual({ mode: 'stdout' });
  });

  it('preserves explicit file output with path', () => {
    const action = normalizeUblBuildAction({
      context: 'acme-prod',
      invoiceNumber: 'FCT-1',
      issueDate: '2026-04-11',
      customerCui: 'RO87654321',
      lines: ['x|1|1|0'],
      output: { mode: 'file', path: '/tmp/invoice.xml' },
    });
    expect(action.output).toEqual({ mode: 'file', path: '/tmp/invoice.xml' });
  });

  it('throws INVALID_OUTPUT_TARGET when mode is file but path is missing', () => {
    let err: unknown;
    try {
      normalizeUblBuildAction({
        context: 'acme-prod',
        invoiceNumber: 'FCT-1',
        issueDate: '2026-04-11',
        customerCui: 'RO87654321',
        lines: ['x|1|1|0'],
        output: { mode: 'file' },
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('INVALID_OUTPUT_TARGET');
  });

  it('rejects invalid issueDate format', () => {
    let err: unknown;
    try {
      normalizeUblBuildAction({
        context: 'acme-prod',
        invoiceNumber: 'FCT-1',
        issueDate: '11/04/2026',
        customerCui: 'RO87654321',
        lines: ['x|1|1|0'],
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('INVALID_DATE');
  });

  it('rejects invalid CUI', () => {
    let err: unknown;
    try {
      normalizeUblBuildAction({
        context: 'acme-prod',
        invoiceNumber: 'FCT-1',
        issueDate: '2026-04-11',
        customerCui: 'not-a-cui',
        lines: ['x|1|1|0'],
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('INVALID_CUI');
  });

  it('passes invoiceTypeCode through to the action', () => {
    const action = normalizeUblBuildAction({
      context: 'acme-prod',
      invoiceNumber: 'FCT-1',
      issueDate: '2026-04-11',
      customerCui: 'RO87654321',
      lines: ['x|1|1|0'],
      invoiceTypeCode: '751',
    });
    expect(action.invoice.invoiceTypeCode).toBe('751');
  });

  it('leaves invoiceTypeCode undefined when omitted (SDK defaults to 380)', () => {
    const action = normalizeUblBuildAction({
      context: 'acme-prod',
      invoiceNumber: 'FCT-1',
      issueDate: '2026-04-11',
      customerCui: 'RO87654321',
      lines: ['x|1|1|0'],
    });
    expect(action.invoice.invoiceTypeCode).toBeUndefined();
  });

  it('rejects an invoice type code outside the CIUS-RO list (380/384/389/751)', () => {
    let err: unknown;
    try {
      normalizeUblBuildAction({
        context: 'acme-prod',
        invoiceNumber: 'FCT-1',
        issueDate: '2026-04-11',
        customerCui: 'RO87654321',
        lines: ['x|1|1|0'],
        invoiceTypeCode: '999',
      } as never);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('INVALID_INVOICE_INPUT');
    expect((err as CliError).category).toBe('user_input');
  });

  it('passes through overrides', () => {
    const action = normalizeUblBuildAction({
      context: 'acme-prod',
      invoiceNumber: 'FCT-1',
      issueDate: '2026-04-11',
      customerCui: 'RO87654321',
      lines: ['x|1|1|0'],
      overrides: {
        customer: { registrationName: 'Custom Name SRL' },
        currency: 'EUR',
      },
    });
    expect(action.invoice.overrides?.customer?.registrationName).toBe('Custom Name SRL');
  });
});
