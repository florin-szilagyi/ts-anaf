import fs from 'node:fs';
import path from 'node:path';
import type { OutputContext } from './types';

export function writeBinary(ctx: OutputContext, bytes: Uint8Array, opts?: { path?: string }): void {
  if (opts?.path) {
    const target = path.resolve(opts.path);
    fs.writeFileSync(target, bytes);
    ctx.streams.stderr.write(`wrote ${target}\n`);
    return;
  }
  ctx.streams.stdout.write(Buffer.from(bytes));
}
