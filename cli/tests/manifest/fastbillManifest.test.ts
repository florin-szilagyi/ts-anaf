import { normalizeManifest, parseManifestString, printJsonSchemaForKind } from '../../src/manifest';
import type { FastbillInvoiceAction } from '../../src/actions';

const MANIFEST_YAML = `
apiVersion: anaf-cli/v1
kind: FastbillInvoice
spec:
  companyId: a0000000-0000-4000-8000-000000000001
  invoiceNumber: FB-9
  issueDate: "2026-07-01"
  customerCui: RO12345678
  lines:
    - "Consulting|2|100|19"
    - description: Hosting
      quantity: 1
      unitPrice: 50
      taxPercent: 19
  idempotencyKey: job-9
  wait: true
`;

describe('FastbillInvoice manifest kind', () => {
  it('parses and normalizes into a fastbill.invoice action', () => {
    const doc = parseManifestString(MANIFEST_YAML);
    expect(doc.kind).toBe('FastbillInvoice');
    const action = normalizeManifest(doc) as FastbillInvoiceAction;
    expect(action.kind).toBe('fastbill.invoice');
    expect(action.invoice.invoiceNumber).toBe('FB-9');
    expect(action.invoice.lines).toEqual([
      { description: 'Consulting', quantity: 2, unitPrice: 100, taxPercent: 19 },
      { description: 'Hosting', quantity: 1, unitPrice: 50, taxPercent: 19 },
    ]);
    expect(action.idempotencyKey).toBe('job-9');
    expect(action.wait).toBe(true);
  });

  it('prints a draft-07 JSON schema for the kind', () => {
    const raw = printJsonSchemaForKind('FastbillInvoice');
    const schema = JSON.parse(raw) as Record<string, unknown>;
    expect(schema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect((schema.properties as Record<string, { const?: string }>).kind.const).toBe('FastbillInvoice');
    const spec = (schema.properties as Record<string, { required?: string[] }>).spec;
    expect(spec.required).toEqual(['companyId', 'invoiceNumber', 'issueDate', 'customerCui', 'lines']);
  });
});
