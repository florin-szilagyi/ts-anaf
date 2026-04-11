import { printJsonSchemaForKind, manifestDocumentSchema } from '../../src/manifest/schemas';

describe('printJsonSchemaForKind', () => {
  for (const kind of ['UblBuild', 'EFacturaUpload'] as const) {
    describe(kind, () => {
      const body = printJsonSchemaForKind(kind);
      const parsed = JSON.parse(body) as Record<string, unknown>;

      it('produces parseable JSON', () => {
        expect(typeof body).toBe('string');
        expect(parsed).toBeTruthy();
      });

      it('declares a JSON-Schema draft-07 object envelope', () => {
        expect(parsed.$schema).toBe('http://json-schema.org/draft-07/schema#');
        expect(parsed.type).toBe('object');
      });

      it('requires apiVersion, kind, and spec at the top level', () => {
        const required = parsed.required as string[];
        expect(required).toEqual(expect.arrayContaining(['apiVersion', 'kind', 'spec']));
      });

      it('pins apiVersion to anaf-cli/v1', () => {
        const props = parsed.properties as Record<string, { const?: string }>;
        expect(props.apiVersion?.const).toBe('anaf-cli/v1');
      });

      it('pins kind to the requested kind', () => {
        const props = parsed.properties as Record<string, { const?: string }>;
        expect(props.kind?.const).toBe(kind);
      });
    });
  }
});

describe('manifestDocumentSchema', () => {
  it('rejects unknown top-level keys (strict)', () => {
    const result = manifestDocumentSchema.safeParse({
      apiVersion: 'anaf-cli/v1',
      kind: 'UblBuild',
      spec: {},
      somethingElse: 1,
    });
    expect(result.success).toBe(false);
  });

  it('accepts a minimal valid envelope', () => {
    const result = manifestDocumentSchema.safeParse({
      apiVersion: 'anaf-cli/v1',
      kind: 'UblBuild',
      spec: { foo: 'bar' },
    });
    expect(result.success).toBe(true);
  });
});
