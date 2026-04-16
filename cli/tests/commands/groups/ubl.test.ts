import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { buildProgram } from '../../../src/commands/buildProgram';
import { CliError } from '../../../src/output/errors';
import { makeOutputContext } from '../../../src/output';
import { ublBuild, ublInspect } from '../../../src/commands/groups/ubl';
import type { UblBuildAction, UblBuildResult } from '../../../src/services';
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
  xmlToReturn = '<?xml version="1.0"?><Invoice><ID>FCT-1</ID></Invoice>';
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

function harness() {
  const stdout = new Cap();
  const stderr = new Cap();
  const text = makeOutputContext({ format: 'text', streams: { stdout, stderr } });
  const json = makeOutputContext({ format: 'json', streams: { stdout, stderr } });
  const ublService = new StubUblService();
  const configStore = new StubConfigStore();
  const services = { ublService, configStore } as never;
  return { stdout, stderr, text, json, ublService, configStore, services };
}

describe('ubl group', () => {
  it('registers build and inspect', () => {
    const program = buildProgram({
      output: makeOutputContext({ format: 'text' }),
      services: {} as never,
      paths: getXdgPaths(),
    });
    const ubl = program.commands.find((c) => c.name() === 'ubl')!;
    expect(ubl.commands.map((c) => c.name()).sort()).toEqual(['build', 'inspect']);
  });

  it('build accepts repeatable --line via the collector', () => {
    const program = buildProgram({
      output: makeOutputContext({ format: 'text' }),
      services: {} as never,
      paths: getXdgPaths(),
    });
    const ubl = program.commands.find((c) => c.name() === 'ubl')!;
    const build = ubl.commands.find((c) => c.name() === 'build')!;
    const lineOpt = build.options.find((o) => o.long === '--line')!;
    expect(lineOpt).toBeDefined();
    expect(Array.isArray(lineOpt.defaultValue)).toBe(true);
  });
});

describe('ublBuild', () => {
  it('builds an action from flags and writes XML to stdout', async () => {
    const h = harness();
    await ublBuild(
      { output: h.text, services: h.services, paths: getXdgPaths() },
      {
        invoiceNumber: 'FCT-1',
        issueDate: '2026-04-11',
        customerCui: 'RO87654321',
        line: ['Servicii|1|1000|19'],
      }
    );
    expect(h.stdout.buf).toContain('<?xml');
    expect(h.stdout.buf).toContain('Invoice');
    expect(h.ublService.lastAction?.invoice.invoiceNumber).toBe('FCT-1');
    expect(h.ublService.lastAction?.invoice.lines).toHaveLength(1);
    // context is the active CUI from configStore
    expect(h.ublService.lastAction?.context).toBe('12345678');
  });

  it('uses the active CUI as context', async () => {
    const h = harness();
    h.configStore.activeCui = '99999999';
    await ublBuild(
      { output: h.text, services: h.services, paths: getXdgPaths() },
      {
        invoiceNumber: 'FCT-CUI',
        issueDate: '2026-04-11',
        customerCui: 'RO87654321',
        line: ['x|1|100|19'],
      }
    );
    expect(h.ublService.lastAction?.context).toBe('99999999');
  });

  it('writes XML to --out and emits confirmation to stderr', async () => {
    const h = harness();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-ubl-'));
    const outPath = path.join(tmp, 'invoice.xml');
    try {
      await ublBuild(
        { output: h.text, services: h.services, paths: getXdgPaths() },
        {
          invoiceNumber: 'FCT-1',
          issueDate: '2026-04-11',
          customerCui: 'RO87654321',
          line: ['x|1|100|19'],
          out: outPath,
        }
      );
      expect(fs.readFileSync(outPath, 'utf8')).toContain('<?xml');
      expect(h.stderr.buf).toContain(outPath);
      expect(h.stdout.buf).toBe('');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('JSON mode emits an envelope with the xml string', async () => {
    const h = harness();
    await ublBuild(
      { output: h.json, services: h.services, paths: getXdgPaths() },
      {
        invoiceNumber: 'FCT-1',
        issueDate: '2026-04-11',
        customerCui: 'RO87654321',
        line: ['x|1|100|19'],
      }
    );
    const parsed = JSON.parse(h.stdout.buf);
    expect(parsed.success).toBe(true);
    expect(parsed.data.invoiceNumber).toBe('FCT-1');
    expect(parsed.data.xml).toContain('<?xml');
    expect(parsed.data.xmlPath).toBeNull();
    expect(typeof parsed.data.xmlLength).toBe('number');
  });

  it('JSON mode reports xmlPath when --out is set and writes the file', async () => {
    const h = harness();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-ubl-'));
    const outPath = path.join(tmp, 'invoice.xml');
    try {
      await ublBuild(
        { output: h.json, services: h.services, paths: getXdgPaths() },
        {
          invoiceNumber: 'FCT-1',
          issueDate: '2026-04-11',
          customerCui: 'RO87654321',
          line: ['x|1|100|19'],
          out: outPath,
        }
      );
      const parsed = JSON.parse(h.stdout.buf);
      expect(parsed.data.xmlPath).toBe(outPath);
      expect(fs.readFileSync(outPath, 'utf8')).toContain('<?xml');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('merges override flags into the action', async () => {
    const h = harness();
    await ublBuild(
      { output: h.text, services: h.services, paths: getXdgPaths() },
      {
        invoiceNumber: 'FCT-2',
        issueDate: '2026-04-11',
        customerCui: 'RO87654321',
        line: ['x|1|100|19'],
        customerName: 'Client Corectat SRL',
        customerCity: 'Cluj-Napoca',
        supplierCity: 'Bucuresti',
      }
    );
    const overrides = h.ublService.lastAction?.invoice.overrides;
    expect(overrides?.customer?.registrationName).toBe('Client Corectat SRL');
    expect(overrides?.customer?.address?.city).toBe('Cluj-Napoca');
    expect(overrides?.supplier?.address?.city).toBe('Bucuresti');
    expect(overrides?.supplier?.registrationName).toBeUndefined();
  });

  it('loads input from --from-json', async () => {
    const h = harness();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-ubl-'));
    try {
      const inputPath = path.join(tmp, 'invoice.json');
      fs.writeFileSync(
        inputPath,
        JSON.stringify({
          context: 'RO12345678',
          invoiceNumber: 'FCT-JSON',
          issueDate: '2026-04-11',
          customerCui: 'RO87654321',
          lines: ['Service|2|50|19'],
        })
      );
      await ublBuild({ output: h.text, services: h.services, paths: getXdgPaths() }, { fromJson: inputPath });
      expect(h.ublService.lastAction?.invoice.invoiceNumber).toBe('FCT-JSON');
      expect(h.ublService.lastAction?.invoice.lines).toHaveLength(1);
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('loads input from --from-yaml', async () => {
    const h = harness();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-ubl-'));
    try {
      const inputPath = path.join(tmp, 'invoice.yaml');
      fs.writeFileSync(
        inputPath,
        'context: RO12345678\ninvoiceNumber: FCT-YAML\nissueDate: 2026-04-11\ncustomerCui: RO87654321\nlines:\n  - "Service|1|100|19"\n'
      );
      await ublBuild({ output: h.text, services: h.services, paths: getXdgPaths() }, { fromYaml: inputPath });
      expect(h.ublService.lastAction?.invoice.invoiceNumber).toBe('FCT-YAML');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('active CUI overrides the context field on a loaded file', async () => {
    const h = harness();
    h.configStore.activeCui = '99999999';
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-ubl-'));
    try {
      const inputPath = path.join(tmp, 'invoice.json');
      fs.writeFileSync(
        inputPath,
        JSON.stringify({
          context: 'other-ctx',
          invoiceNumber: 'FCT-OV',
          issueDate: '2026-04-11',
          customerCui: 'RO87654321',
          lines: ['x|1|100|19'],
        })
      );
      await ublBuild({ output: h.text, services: h.services, paths: getXdgPaths() }, { fromJson: inputPath });
      // The active CUI from configStore always overrides the file's context
      expect(h.ublService.lastAction?.context).toBe('99999999');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('throws BAD_USAGE when --from-json and flags both supplied', async () => {
    const h = harness();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-ubl-'));
    try {
      const inputPath = path.join(tmp, 'invoice.json');
      fs.writeFileSync(inputPath, '{}');
      await expect(
        ublBuild(
          { output: h.text, services: h.services, paths: getXdgPaths() },
          { fromJson: inputPath, invoiceNumber: 'FCT-X' }
        )
      ).rejects.toBeInstanceOf(CliError);
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('accepts an empty --line array with --from-json (commander default)', async () => {
    const h = harness();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-ubl-'));
    try {
      const inputPath = path.join(tmp, 'invoice.json');
      fs.writeFileSync(
        inputPath,
        JSON.stringify({
          context: 'RO12345678',
          invoiceNumber: 'FCT-OK',
          issueDate: '2026-04-11',
          customerCui: 'RO87654321',
          lines: ['x|1|100|19'],
        })
      );
      await ublBuild({ output: h.text, services: h.services, paths: getXdgPaths() }, { fromJson: inputPath, line: [] });
      expect(h.ublService.lastAction?.invoice.invoiceNumber).toBe('FCT-OK');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('throws BAD_USAGE when required flags are missing', async () => {
    const h = harness();
    await expect(ublBuild({ output: h.text, services: h.services, paths: getXdgPaths() }, {})).rejects.toBeInstanceOf(
      CliError
    );
  });
});

describe('ublInspect', () => {
  it('reads a file and prints metadata', async () => {
    const h = harness();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-ubl-i-'));
    try {
      const xmlPath = path.join(tmp, 'sample.xml');
      fs.writeFileSync(
        xmlPath,
        '<?xml version="1.0"?><Invoice><ID>FCT-1</ID><IssueDate>2026-04-11</IssueDate></Invoice>'
      );
      await ublInspect({ output: h.text, services: h.services, paths: getXdgPaths() }, { xml: xmlPath });
      expect(h.stdout.buf).toContain('Root element');
      expect(h.stdout.buf).toContain('Invoice');
      expect(h.stdout.buf).toContain('Size');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('json mode emits structured metadata', async () => {
    const h = harness();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-ubl-i-'));
    try {
      const xmlPath = path.join(tmp, 'sample.xml');
      fs.writeFileSync(xmlPath, '<?xml version="1.0"?><Invoice><ID>x</ID></Invoice>');
      await ublInspect({ output: h.json, services: h.services, paths: getXdgPaths() }, { xml: xmlPath });
      const parsed = JSON.parse(h.stdout.buf);
      expect(parsed.data.rootElement).toBe('Invoice');
      expect(Array.isArray(parsed.data.firstElementNames)).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('throws BAD_USAGE when --xml is missing', async () => {
    const h = harness();
    await expect(ublInspect({ output: h.text, services: h.services, paths: getXdgPaths() }, {})).rejects.toBeInstanceOf(
      CliError
    );
  });
});
