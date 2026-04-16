import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { buildProgram } from '../../../src/commands/buildProgram';
import { makeOutputContext } from '../../../src/output';
import { CliError } from '../../../src/output/errors';
import { runCommand } from '../../../src/commands/groups/run';
import type { UblBuildAction } from '../../../src/actions';
import type { UblBuildResult } from '../../../src/services';
import { getXdgPaths } from '../../../src/state';

class Cap extends Writable {
  buf = '';
  _write(c: Buffer, _e: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.buf += c.toString('utf8');
    cb();
  }
}

class StubUblService {
  lastAction?: UblBuildAction;
  xmlToReturn = '<?xml version="1.0"?><Invoice><ID>FCT-M</ID></Invoice>';
  async buildFromAction(action: UblBuildAction): Promise<UblBuildResult> {
    this.lastAction = action;
    return {
      xml: this.xmlToReturn,
      invoice: {
        invoiceNumber: action.invoice.invoiceNumber,
        issueDate: action.invoice.issueDate,
        supplier: {
          registrationName: 'S',
          companyId: '1',
          address: { street: '-', city: '-', postalZone: '-' },
        },
        customer: {
          registrationName: 'C',
          companyId: '2',
          address: { street: '-', city: '-', postalZone: '-' },
        },
        lines: [],
      } as never,
    };
  }
}

class StubConfigStore {
  activeCui: string | undefined = '12345678';
  getActiveCui(): string | undefined {
    return this.activeCui;
  }
  setActiveCui(cui: string | undefined): void {
    this.activeCui = cui;
  }
  getEnv(): 'test' | 'prod' {
    return 'test';
  }
  setEnv(): void {}
  read() {
    return { activeCui: this.activeCui };
  }
  write() {}
}

interface UploadArgsLike {
  xml: string;
  clientSecret: string;
  isB2C?: boolean;
  options?: { standard?: string; executare?: boolean };
}

class StubEfacturaService {
  uploadCalls: UploadArgsLike[] = [];
  async upload(
    args: UploadArgsLike
  ): Promise<{ indexIncarcare: string; dateResponse: string; executionStatus: string }> {
    this.uploadCalls.push(args);
    return { indexIncarcare: 'u-777', dateResponse: '2026', executionStatus: '0' };
  }
}

function harness(): {
  stdout: Cap;
  stderr: Cap;
  text: ReturnType<typeof makeOutputContext>;
  json: ReturnType<typeof makeOutputContext>;
  ublService: StubUblService;
  configStore: StubConfigStore;
  efacturaService: StubEfacturaService;
  services: never;
} {
  const stdout = new Cap();
  const stderr = new Cap();
  const text = makeOutputContext({ format: 'text', streams: { stdout, stderr } });
  const json = makeOutputContext({ format: 'json', streams: { stdout, stderr } });
  const ublService = new StubUblService();
  const configStore = new StubConfigStore();
  const efacturaService = new StubEfacturaService();
  const services = { ublService, configStore, efacturaService } as never;
  return { stdout, stderr, text, json, ublService, configStore, efacturaService, services };
}

function writeTmp(contents: string, name = 'job.yaml'): { dir: string; file: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-run-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  return { dir, file, cleanup: () => fs.rmSync(dir, { recursive: true }) };
}

const VALID_UBL_MANIFEST = `
apiVersion: anaf-cli/v1
kind: UblBuild
context: acme-prod
spec:
  invoiceNumber: FCT-M
  issueDate: 2026-04-11
  customerCui: RO87654321
  lines:
    - "x|1|100|19"
`;

describe('run group', () => {
  it('registers run command with --file and --dry-run', () => {
    const program = buildProgram({
      output: makeOutputContext({ format: 'text' }),
      services: {} as never,
      paths: getXdgPaths(),
    });
    const run = program.commands.find((c) => c.name() === 'run')!;
    const longs = run.options.map((o) => o.long);
    expect(longs).toEqual(expect.arrayContaining(['--file', '--dry-run']));
  });
});

describe('runCommand — argument validation', () => {
  it('throws BAD_USAGE when --file is missing', async () => {
    const h = harness();
    await expect(runCommand({ output: h.text, services: h.services, paths: getXdgPaths() }, {})).rejects.toBeInstanceOf(
      CliError
    );
  });
});

describe('runCommand — dry-run', () => {
  it('emits the normalized UblBuild action as JSON in text mode', async () => {
    const h = harness();
    const { file, cleanup } = writeTmp(VALID_UBL_MANIFEST);
    try {
      await runCommand({ output: h.text, services: h.services, paths: getXdgPaths() }, { file, dryRun: true });
      const parsed = JSON.parse(h.stdout.buf) as { kind: string; invoice: { invoiceNumber: string } };
      expect(parsed.kind).toBe('ubl.build');
      expect(parsed.invoice.invoiceNumber).toBe('FCT-M');
      // Dry run must NOT call the service.
      expect(h.ublService.lastAction).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it('emits a JSON envelope with the normalized action in --format json mode', async () => {
    const h = harness();
    const { file, cleanup } = writeTmp(VALID_UBL_MANIFEST);
    try {
      await runCommand({ output: h.json, services: h.services, paths: getXdgPaths() }, { file, dryRun: true });
      const parsed = JSON.parse(h.stdout.buf) as { success: boolean; data: { kind: string } };
      expect(parsed.success).toBe(true);
      expect(parsed.data.kind).toBe('ubl.build');
    } finally {
      cleanup();
    }
  });

  it('surfaces INVALID_INVOICE_INPUT when dry-run manifest spec is malformed', async () => {
    const h = harness();
    const { file, cleanup } = writeTmp(`
apiVersion: anaf-cli/v1
kind: UblBuild
context: acme-prod
spec:
  invoiceNumber: ""
  issueDate: 2026-04-11
  customerCui: RO87654321
  lines:
    - "x|1|100|19"
`);
    try {
      await expect(
        runCommand({ output: h.text, services: h.services, paths: getXdgPaths() }, { file, dryRun: true })
      ).rejects.toBeInstanceOf(CliError);
    } finally {
      cleanup();
    }
  });
});

describe('runCommand — UblBuild dispatch', () => {
  it('writes raw XML to stdout when output mode is stdout', async () => {
    const h = harness();
    const { file, cleanup } = writeTmp(VALID_UBL_MANIFEST);
    try {
      await runCommand({ output: h.text, services: h.services, paths: getXdgPaths() }, { file });
      expect(h.stdout.buf).toContain('<?xml');
      expect(h.stdout.buf).toContain('Invoice');
      expect(h.ublService.lastAction?.invoice.invoiceNumber).toBe('FCT-M');
      // Context was resolved from the active CUI in configStore
      expect(h.ublService.lastAction?.context).toBe('12345678');
    } finally {
      cleanup();
    }
  });

  it('writes XML to --file output and emits stderr confirmation', async () => {
    const h = harness();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-run-'));
    try {
      const outPath = path.join(tmp, 'invoice.xml');
      const manifest = `
apiVersion: anaf-cli/v1
kind: UblBuild
context: acme-prod
spec:
  invoiceNumber: FCT-W
  issueDate: 2026-04-11
  customerCui: RO87654321
  lines:
    - "x|1|100|19"
output:
  mode: file
  path: ${outPath}
`;
      const manifestPath = path.join(tmp, 'job.yaml');
      fs.writeFileSync(manifestPath, manifest);
      await runCommand({ output: h.text, services: h.services, paths: getXdgPaths() }, { file: manifestPath });
      expect(fs.readFileSync(outPath, 'utf8')).toContain('<?xml');
      expect(h.stderr.buf).toContain(outPath);
      // Stdout stays clean when writing to a file in text mode.
      expect(h.stdout.buf).toBe('');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('emits a JSON envelope with xml string in --format json mode (stdout target)', async () => {
    const h = harness();
    const { file, cleanup } = writeTmp(VALID_UBL_MANIFEST);
    try {
      await runCommand({ output: h.json, services: h.services, paths: getXdgPaths() }, { file });
      const parsed = JSON.parse(h.stdout.buf) as { success: boolean; data: { xml: string; xmlPath: string | null } };
      expect(parsed.success).toBe(true);
      expect(parsed.data.xml).toContain('<?xml');
      expect(parsed.data.xmlPath).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe('runCommand — EFacturaUpload dispatch', () => {
  const prevEnv = process.env.ANAF_CLIENT_SECRET;
  beforeEach(() => {
    process.env.ANAF_CLIENT_SECRET = 'test-secret';
  });
  afterEach(() => {
    if (prevEnv === undefined) delete process.env.ANAF_CLIENT_SECRET;
    else process.env.ANAF_CLIENT_SECRET = prevEnv;
  });

  it('uploads an xmlFile source through the efactura service', async () => {
    const h = harness();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-run-'));
    try {
      const xmlPath = path.join(tmp, 'invoice.xml');
      fs.writeFileSync(xmlPath, '<?xml version="1.0"?><Invoice/>');
      const manifestPath = path.join(tmp, 'job.yaml');
      fs.writeFileSync(
        manifestPath,
        `
apiVersion: anaf-cli/v1
kind: EFacturaUpload
context: acme-prod
spec:
  source:
    xmlFile: ${xmlPath}
  upload:
    standard: UBL
    isB2C: false
`
      );
      await runCommand({ output: h.text, services: h.services, paths: getXdgPaths() }, { file: manifestPath });
      expect(h.efacturaService.uploadCalls).toHaveLength(1);
      const call = h.efacturaService.uploadCalls[0];
      expect(call.xml).toContain('<?xml');
      expect(call.clientSecret).toBe('test-secret');
      expect(call.isB2C).toBe(false);
      expect(call.options?.standard).toBe('UBL');
      expect(h.stdout.buf).toContain('u-777');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('builds XML from a ublBuild source and uploads it', async () => {
    const h = harness();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-run-'));
    try {
      const manifestPath = path.join(tmp, 'job.yaml');
      fs.writeFileSync(
        manifestPath,
        `
apiVersion: anaf-cli/v1
kind: EFacturaUpload
context: acme-prod
spec:
  source:
    ublBuild:
      context: acme-prod
      invoiceNumber: FCT-NESTED
      issueDate: 2026-04-11
      customerCui: RO87654321
      lines:
        - "x|1|100|19"
  upload:
    standard: UBL
`
      );
      await runCommand({ output: h.text, services: h.services, paths: getXdgPaths() }, { file: manifestPath });
      expect(h.ublService.lastAction?.invoice.invoiceNumber).toBe('FCT-NESTED');
      expect(h.efacturaService.uploadCalls).toHaveLength(1);
      expect(h.efacturaService.uploadCalls[0].xml).toContain('<?xml');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('throws BAD_USAGE for an xmlStdin source', async () => {
    const h = harness();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-run-'));
    try {
      const manifestPath = path.join(tmp, 'job.yaml');
      fs.writeFileSync(
        manifestPath,
        `
apiVersion: anaf-cli/v1
kind: EFacturaUpload
context: acme-prod
spec:
  source:
    xmlStdin: true
  upload:
    standard: UBL
`
      );
      let error: unknown;
      try {
        await runCommand({ output: h.text, services: h.services, paths: getXdgPaths() }, { file: manifestPath });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).code).toBe('BAD_USAGE');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('throws CLIENT_SECRET_MISSING when ANAF_CLIENT_SECRET is unset', async () => {
    delete process.env.ANAF_CLIENT_SECRET;
    const h = harness();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-run-'));
    try {
      const xmlPath = path.join(tmp, 'invoice.xml');
      fs.writeFileSync(xmlPath, '<?xml?><Invoice/>');
      const manifestPath = path.join(tmp, 'job.yaml');
      fs.writeFileSync(
        manifestPath,
        `
apiVersion: anaf-cli/v1
kind: EFacturaUpload
context: acme-prod
spec:
  source:
    xmlFile: ${xmlPath}
  upload:
    standard: UBL
`
      );
      let error: unknown;
      try {
        await runCommand({ output: h.text, services: h.services, paths: getXdgPaths() }, { file: manifestPath });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).code).toBe('CLIENT_SECRET_MISSING');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });
});
