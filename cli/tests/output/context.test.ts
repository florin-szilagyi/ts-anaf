import { Writable } from 'node:stream';
import { defaultStreams, makeOutputContext } from '../../src/output/context';

describe('defaultStreams', () => {
  it('returns the real process streams', () => {
    const streams = defaultStreams();
    expect(streams.stdout).toBe(process.stdout);
    expect(streams.stderr).toBe(process.stderr);
  });
});

describe('makeOutputContext', () => {
  it('defaults format to text and uses real streams', () => {
    const ctx = makeOutputContext({});
    expect(ctx.format).toBe('text');
    expect(ctx.streams.stdout).toBe(process.stdout);
  });

  it('honors explicit format and injected streams', () => {
    const out = new Writable({ write: (_c, _e, cb) => cb() });
    const err = new Writable({ write: (_c, _e, cb) => cb() });
    const ctx = makeOutputContext({ format: 'json', streams: { stdout: out, stderr: err } });
    expect(ctx.format).toBe('json');
    expect(ctx.streams.stdout).toBe(out);
    expect(ctx.streams.stderr).toBe(err);
  });
});
