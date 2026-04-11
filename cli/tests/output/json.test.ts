import { Writable } from 'node:stream';
import { renderSuccess, renderError } from '../../src/output/json';
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
  return { ctx: { format: 'json', streams: { stdout: out, stderr: err } }, out, err };
}

describe('json renderSuccess', () => {
  it('wraps the data in a SuccessEnvelope and prints to stdout with newline', () => {
    const { ctx: c, out } = ctx();
    renderSuccess(c, { name: 'acme', cui: 'RO12345678' });
    const parsed = JSON.parse(out.text().trim());
    expect(parsed).toEqual({ success: true, data: { name: 'acme', cui: 'RO12345678' } });
    expect(out.text().endsWith('\n')).toBe(true);
  });

  it('handles arrays and primitives', () => {
    const { ctx: c, out } = ctx();
    renderSuccess(c, [1, 2, 3]);
    expect(JSON.parse(out.text())).toEqual({ success: true, data: [1, 2, 3] });
  });
});

describe('json renderError', () => {
  it('serializes a CliError into the error envelope on stderr', () => {
    const { ctx: c, err } = ctx();
    renderError(
      c,
      new CliError({
        code: 'AUTH_FAILED',
        message: 'refresh token expired',
        category: 'auth',
        details: { context: 'acme-prod' },
      })
    );
    expect(JSON.parse(err.text())).toEqual({
      success: false,
      error: {
        code: 'AUTH_FAILED',
        message: 'refresh token expired',
        details: { context: 'acme-prod' },
      },
    });
  });

  it('serializes a plain Error with code GENERIC', () => {
    const { ctx: c, err } = ctx();
    renderError(c, new Error('boom'));
    expect(JSON.parse(err.text())).toEqual({
      success: false,
      error: { code: 'GENERIC', message: 'boom' },
    });
  });

  it('omits details when undefined', () => {
    const { ctx: c, err } = ctx();
    renderError(c, new CliError({ code: 'X', message: 'y', category: 'generic' }));
    const parsed = JSON.parse(err.text());
    expect(parsed.error).not.toHaveProperty('details');
  });
});
