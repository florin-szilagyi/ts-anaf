import { CliError } from './errors';
import type { ErrorEnvelope, OutputContext, SuccessEnvelope } from './types';

export function renderSuccess<T>(ctx: OutputContext, data: T): void {
  const envelope: SuccessEnvelope<T> = { success: true, data };
  ctx.streams.stdout.write(`${JSON.stringify(envelope)}\n`);
}

export function renderError(ctx: OutputContext, error: CliError | Error): void {
  const envelope: ErrorEnvelope = {
    success: false,
    error: {
      code: error instanceof CliError ? error.code : 'GENERIC',
      message: error.message,
      ...(error instanceof CliError && error.details !== undefined ? { details: error.details } : {}),
    },
  };
  ctx.streams.stderr.write(`${JSON.stringify(envelope)}\n`);
}
