import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { parseManifestFile, parseManifestString } from '../../src/manifest/parser';
import { CliError } from '../../src/output/errors';

const FIXTURES = path.resolve(__dirname, 'fixtures');

describe('parseManifestFile (golden fixtures)', () => {
  it('parses a valid UblBuild YAML manifest', () => {
    const doc = parseManifestFile(path.join(FIXTURES, 'ubl-build.yaml'));
    expect(doc.apiVersion).toBe('anaf-cli/v1');
    expect(doc.kind).toBe('UblBuild');
    expect(doc.context).toBe('acme-prod');
    expect(doc.spec.invoiceNumber).toBe('FCT-100');
    expect(Array.isArray(doc.spec.lines)).toBe(true);
    expect(doc.output?.mode).toBe('stdout');
  });

  it('parses a valid EFacturaUpload YAML manifest with ublBuild source', () => {
    const doc = parseManifestFile(path.join(FIXTURES, 'efactura-upload.yaml'));
    expect(doc.kind).toBe('EFacturaUpload');
    const spec = doc.spec as { source?: { ublBuild?: unknown }; upload?: { standard?: string } };
    expect(spec.source?.ublBuild).toBeDefined();
    expect(spec.upload?.standard).toBe('UBL');
  });

  it('rejects a manifest with a bad apiVersion (UNSUPPORTED_API_VERSION)', () => {
    let error: unknown;
    try {
      parseManifestFile(path.join(FIXTURES, 'invalid-version.yaml'));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe('UNSUPPORTED_API_VERSION');
    expect((error as CliError).category).toBe('user_input');
  });

  it('rejects a manifest with an unknown kind (UNKNOWN_MANIFEST_KIND)', () => {
    let error: unknown;
    try {
      parseManifestFile(path.join(FIXTURES, 'invalid-kind.yaml'));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe('UNKNOWN_MANIFEST_KIND');
  });

  it('throws INVALID_MANIFEST_FILE when the path does not exist', () => {
    let error: unknown;
    try {
      parseManifestFile(path.join(FIXTURES, 'does-not-exist.yaml'));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe('INVALID_MANIFEST_FILE');
  });

  it('parses a JSON manifest via a .json extension', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-manifest-'));
    try {
      const p = path.join(tmp, 'job.json');
      fs.writeFileSync(
        p,
        JSON.stringify({
          apiVersion: 'anaf-cli/v1',
          kind: 'UblBuild',
          spec: {
            context: 'acme-prod',
            invoiceNumber: 'FCT-J',
            issueDate: '2026-04-11',
            customerCui: 'RO87654321',
            lines: ['x|1|100|19'],
          },
        })
      );
      const doc = parseManifestFile(p);
      expect(doc.kind).toBe('UblBuild');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });
});

describe('parseManifestString', () => {
  it('returns a validated document for valid YAML', () => {
    const doc = parseManifestString(
      `
apiVersion: anaf-cli/v1
kind: UblBuild
spec:
  context: acme-prod
  invoiceNumber: FCT-1
  issueDate: 2026-04-11
  customerCui: RO87654321
  lines:
    - "x|1|100|19"
`
    );
    expect(doc.kind).toBe('UblBuild');
  });

  it('throws INVALID_MANIFEST_FILE on YAML parse failure', () => {
    let error: unknown;
    try {
      parseManifestString(':::::not valid: yaml:: [[[');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe('INVALID_MANIFEST_FILE');
  });

  it('throws INVALID_MANIFEST_FILE on empty body', () => {
    let error: unknown;
    try {
      parseManifestString('');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe('INVALID_MANIFEST_FILE');
  });

  it('throws INVALID_MANIFEST_DOCUMENT when spec is missing', () => {
    let error: unknown;
    try {
      parseManifestString(
        `
apiVersion: anaf-cli/v1
kind: UblBuild
`
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe('INVALID_MANIFEST_DOCUMENT');
  });

  it('throws INVALID_MANIFEST_DOCUMENT when an unknown top-level field is present', () => {
    let error: unknown;
    try {
      parseManifestString(
        `
apiVersion: anaf-cli/v1
kind: UblBuild
surprise: yes
spec:
  invoiceNumber: x
`
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).code).toBe('INVALID_MANIFEST_DOCUMENT');
  });

  it('throws UNSUPPORTED_API_VERSION before UNKNOWN_MANIFEST_KIND when both fail', () => {
    let error: unknown;
    try {
      parseManifestString(
        `
apiVersion: v99
kind: Nope
spec: {}
`
      );
    } catch (e) {
      error = e;
    }
    expect((error as CliError).code).toBe('UNSUPPORTED_API_VERSION');
  });

  it('parses JSON when hint is json', () => {
    const doc = parseManifestString(
      JSON.stringify({
        apiVersion: 'anaf-cli/v1',
        kind: 'UblBuild',
        spec: { a: 1 },
      }),
      'json'
    );
    expect(doc.kind).toBe('UblBuild');
  });
});
