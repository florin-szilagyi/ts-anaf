import { CliError } from './errors';
import type { OutputContext } from './types';

export function renderSuccess<T>(ctx: OutputContext, data: T, humanText?: (data: T) => string): void {
  const line = humanText ? humanText(data) : JSON.stringify(data);
  ctx.streams.stdout.write(`${line}\n`);
}

export function renderError(ctx: OutputContext, error: CliError | Error): void {
  const code = error instanceof CliError ? error.code : 'GENERIC';
  ctx.streams.stderr.write(`${code}: ${error.message}\n`);
}
