import { Writable } from 'node:stream';
import { buildProgram } from '../../../src/commands/buildProgram';
import { makeOutputContext } from '../../../src/output';
import { schemaPrint } from '../../../src/commands/groups/schema';
import { CliError } from '../../../src/output/errors';

class Cap extends Writable {
  buf = '';
  _write(c: Buffer, _e: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.buf += c.toString('utf8');
    cb();
  }
}

function harness(): {
  stdout: Cap;
  stderr: Cap;
  text: ReturnType<typeof makeOutputContext>;
  json: ReturnType<typeof makeOutputContext>;
  services: never;
} {
  const stdout = new Cap();
  const stderr = new Cap();
  const text = makeOutputContext({ format: 'text', streams: { stdout, stderr } });
  const json = makeOutputContext({ format: 'json', streams: { stdout, stderr } });
  return { stdout, stderr, text, json, services: {} as never };
}

describe('schema group', () => {
  it('registers print', () => {
    const program = buildProgram({ output: makeOutputContext({ format: 'text' }), services: {} as never });
    const s = program.commands.find((c) => c.name() === 'schema')!;
    expect(s.commands.map((c) => c.name())).toEqual(['print']);
  });
});

describe('schemaPrint handler', () => {
  it('writes a parseable JSON object for UblBuild', async () => {
    const h = harness();
    await schemaPrint({ output: h.text, services: h.services }, 'UblBuild');
    const parsed = JSON.parse(h.stdout.buf) as {
      type?: string;
      required?: string[];
      properties?: Record<string, { const?: string }>;
    };
    expect(parsed.type).toBe('object');
    expect(parsed.required).toEqual(expect.arrayContaining(['apiVersion', 'kind', 'spec']));
    expect(parsed.properties?.kind?.const).toBe('UblBuild');
  });

  it('writes a parseable JSON object for EFacturaUpload', async () => {
    const h = harness();
    await schemaPrint({ output: h.text, services: h.services }, 'EFacturaUpload');
    const parsed = JSON.parse(h.stdout.buf) as { type?: string; properties?: Record<string, { const?: string }> };
    expect(parsed.type).toBe('object');
    expect(parsed.properties?.kind?.const).toBe('EFacturaUpload');
  });

  it('emits raw JSON (no success envelope wrapping) even in json output mode', async () => {
    const h = harness();
    await schemaPrint({ output: h.json, services: h.services }, 'UblBuild');
    const parsed = JSON.parse(h.stdout.buf) as { success?: unknown; type?: string };
    // The envelope adds {success,data}. Raw schema print bypasses it.
    expect(parsed.success).toBeUndefined();
    expect(parsed.type).toBe('object');
  });

  it('terminates output with a trailing newline', async () => {
    const h = harness();
    await schemaPrint({ output: h.text, services: h.services }, 'UblBuild');
    expect(h.stdout.buf.endsWith('\n')).toBe(true);
  });

  it('throws UNKNOWN_MANIFEST_KIND for a bad kind', async () => {
    const h = harness();
    await expect(schemaPrint({ output: h.text, services: h.services }, 'Bogus')).rejects.toBeInstanceOf(CliError);
  });
});
