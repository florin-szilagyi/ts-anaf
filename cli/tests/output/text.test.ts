import { Writable } from 'node:stream';
import { renderSuccess, renderError } from '../../src/output/text';
import { CliError } from '../../src/output/errors';
import type { OutputContext } from '../../src/output/types';

class CaptureStream extends Writable {
  chunks: string[] = [];
  _write(chunk: Buffer, _enc: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.chunks.push(chunk.toString('utf8'));
    cb();
  }
  text(): string {
    return this.chunks.join('');
  }
}

function ctx(): { ctx: OutputContext; out: CaptureStream; err: CaptureStream } {
  const out = new CaptureStream();
  const err = new CaptureStream();
  return { ctx: { format: 'text', streams: { stdout: out, stderr: err } }, out, err };
}

describe('text renderSuccess', () => {
  it('writes the human formatter output to stdout with a trailing newline', () => {
    const { ctx: c, out } = ctx();
    renderSuccess(c, { name: 'acme' }, (d) => `context: ${d.name}`);
    expect(out.text()).toBe('context: acme\n');
  });

  it('falls back to JSON.stringify when no human formatter is supplied', () => {
    const { ctx: c, out } = ctx();
    renderSuccess(c, { x: 1 });
    expect(out.text()).toBe('{"x":1}\n');
  });
});

describe('text renderError', () => {
  it('writes "<code>: <message>" to stderr with a trailing newline', () => {
    const { ctx: c, err } = ctx();
    renderError(c, new CliError({ code: 'AUTH_FAILED', message: 'token expired', category: 'auth' }));
    expect(err.text()).toBe('AUTH_FAILED: token expired\n');
  });

  it('uses GENERIC for plain Errors', () => {
    const { ctx: c, err } = ctx();
    renderError(c, new Error('boom'));
    expect(err.text()).toBe('GENERIC: boom\n');
  });
});
