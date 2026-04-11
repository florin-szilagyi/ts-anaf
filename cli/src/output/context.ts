import type { OutputContext, OutputFormat, WriteStreams } from './types';

export function defaultStreams(): WriteStreams {
  return { stdout: process.stdout, stderr: process.stderr };
}

export function makeOutputContext(args: { format?: OutputFormat; streams?: WriteStreams }): OutputContext {
  return {
    format: args.format ?? 'text',
    streams: args.streams ?? defaultStreams(),
  };
}
