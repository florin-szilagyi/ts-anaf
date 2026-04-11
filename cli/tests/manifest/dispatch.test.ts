import { normalizeManifest } from '../../src/manifest/dispatch';
import { CliError } from '../../src/output/errors';
import type { ManifestDocument } from '../../src/manifest/types';

describe('normalizeManifest — UblBuild', () => {
  it('produces a UblBuildAction for a valid manifest', () => {
    const doc: ManifestDocument = {
      apiVersion: 'anaf-cli/v1',
      kind: 'UblBuild',
      context: 'acme-prod',
      spec: {
        invoiceNumber: 'FCT-1',
        issueDate: '2026-04-11',
        customerCui: 'RO87654321',
        lines: ['Servicii|1|1000|19'],
      },
    };
    const action = normalizeManifest(doc);
    expect(action.kind).toBe('ubl.build');
    if (action.kind !== 'ubl.build') throw new Error('wrong kind');
    expect(action.context).toBe('acme-prod');
    expect(action.invoice.invoiceNumber).toBe('FCT-1');
    expect(action.invoice.lines).toHaveLength(1);
    expect(action.output.mode).toBe('stdout');
  });

  it('uses the top-level context when inner spec.context is also set (top-level wins)', () => {
    const doc: ManifestDocument = {
      apiVersion: 'anaf-cli/v1',
      kind: 'UblBuild',
      context: 'top-ctx',
      spec: {
        context: 'inner-ctx',
        invoiceNumber: 'FCT-1',
        issueDate: '2026-04-11',
        customerCui: 'RO87654321',
        lines: ['x|1|100|19'],
      },
    };
    const action = normalizeManifest(doc);
    if (action.kind !== 'ubl.build') throw new Error('wrong kind');
    expect(action.context).toBe('top-ctx');
  });

  it('falls back to spec.context when top-level context is missing', () => {
    const doc: ManifestDocument = {
      apiVersion: 'anaf-cli/v1',
      kind: 'UblBuild',
      spec: {
        context: 'inner-ctx',
        invoiceNumber: 'FCT-1',
        issueDate: '2026-04-11',
        customerCui: 'RO87654321',
        lines: ['x|1|100|19'],
      },
    };
    const action = normalizeManifest(doc);
    if (action.kind !== 'ubl.build') throw new Error('wrong kind');
    expect(action.context).toBe('inner-ctx');
  });

  it('throws INVALID_INVOICE_INPUT when neither context is set', () => {
    const doc: ManifestDocument = {
      apiVersion: 'anaf-cli/v1',
      kind: 'UblBuild',
      spec: {
        invoiceNumber: 'FCT-1',
        issueDate: '2026-04-11',
        customerCui: 'RO87654321',
        lines: ['x|1|100|19'],
      },
    };
    let error: unknown;
    try {
      normalizeManifest(doc);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe('INVALID_INVOICE_INPUT');
  });

  it('injects the envelope output into the action when spec has no output', () => {
    const doc: ManifestDocument = {
      apiVersion: 'anaf-cli/v1',
      kind: 'UblBuild',
      context: 'acme-prod',
      spec: {
        invoiceNumber: 'FCT-1',
        issueDate: '2026-04-11',
        customerCui: 'RO87654321',
        lines: ['x|1|100|19'],
      },
      output: { mode: 'file', path: '/tmp/out.xml' },
    };
    const action = normalizeManifest(doc);
    expect(action.output).toEqual({ mode: 'file', path: '/tmp/out.xml' });
  });
});

describe('normalizeManifest — EFacturaUpload', () => {
  it('produces an EfacturaUploadAction with an xmlFile source', () => {
    const doc: ManifestDocument = {
      apiVersion: 'anaf-cli/v1',
      kind: 'EFacturaUpload',
      context: 'acme-prod',
      spec: {
        source: { xmlFile: '/tmp/invoice.xml' },
        upload: { standard: 'UBL', isB2C: false },
      },
    };
    const action = normalizeManifest(doc);
    expect(action.kind).toBe('efactura.upload');
    if (action.kind !== 'efactura.upload') throw new Error('wrong kind');
    expect(action.source.type).toBe('xmlFile');
    if (action.source.type !== 'xmlFile') throw new Error('wrong source');
    expect(action.source.path).toBe('/tmp/invoice.xml');
    expect(action.upload.standard).toBe('UBL');
    expect(action.context).toBe('acme-prod');
  });

  it('produces a nested ubl.build action for a ublBuild source', () => {
    const doc: ManifestDocument = {
      apiVersion: 'anaf-cli/v1',
      kind: 'EFacturaUpload',
      context: 'acme-prod',
      spec: {
        source: {
          ublBuild: {
            context: 'acme-prod',
            invoiceNumber: 'FCT-E',
            issueDate: '2026-04-11',
            customerCui: 'RO87654321',
            lines: ['x|1|100|19'],
          },
        },
        upload: { standard: 'UBL' },
      },
    };
    const action = normalizeManifest(doc);
    if (action.kind !== 'efactura.upload') throw new Error('wrong kind');
    if (action.source.type !== 'ublBuild') throw new Error('wrong source');
    expect(action.source.build.invoice.invoiceNumber).toBe('FCT-E');
  });

  it('throws INVALID_UPLOAD_INPUT when source has zero branches', () => {
    const doc: ManifestDocument = {
      apiVersion: 'anaf-cli/v1',
      kind: 'EFacturaUpload',
      context: 'acme-prod',
      spec: {
        source: {},
        upload: { standard: 'UBL' },
      },
    };
    let error: unknown;
    try {
      normalizeManifest(doc);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe('INVALID_UPLOAD_INPUT');
  });
});

describe('normalizeManifest — invalid kind at runtime', () => {
  it('throws UNKNOWN_MANIFEST_KIND for a kind past the type', () => {
    const doc = {
      apiVersion: 'anaf-cli/v1',
      kind: 'Bogus',
      spec: {},
    } as unknown as ManifestDocument;
    let error: unknown;
    try {
      normalizeManifest(doc);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe('UNKNOWN_MANIFEST_KIND');
  });
});
