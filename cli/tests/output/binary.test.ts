import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { writeBinary } from '../../src/output/binary';
import type { OutputContext } from '../../src/output/types';

class CaptureStream extends Writable {
  chunks: Buffer[] = [];
  _write(chunk: Buffer, _enc: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.chunks.push(chunk);
    cb();
  }
  bytes(): Buffer {
    return Buffer.concat(this.chunks);
  }
  text(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

function ctx(): { ctx: OutputContext; out: CaptureStream; err: CaptureStream } {
  const out = new CaptureStream();
  const err = new CaptureStream();
  return { ctx: { format: 'text', streams: { stdout: out, stderr: err } }, out, err };
}

describe('writeBinary', () => {
  it('writes bytes to stdout when no path is given', () => {
    const { ctx: c, out } = ctx();
    const payload = Uint8Array.from([0x25, 0x50, 0x44, 0x46]); // %PDF
    writeBinary(c, payload);
    expect(out.bytes().equals(Buffer.from(payload))).toBe(true);
  });

  it('writes bytes to a file when path is given and emits a one-line confirmation to stderr', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-binary-'));
    const target = path.join(dir, 'out.pdf');
    const { ctx: c, out, err } = ctx();
    const payload = Uint8Array.from([1, 2, 3, 4, 5]);

    writeBinary(c, payload, { path: target });

    const written = fs.readFileSync(target);
    expect(written.equals(Buffer.from(payload))).toBe(true);
    expect(out.bytes().length).toBe(0); // nothing on stdout when path is set
    expect(err.text()).toContain(target);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
