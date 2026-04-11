export type {
  OutputFormat,
  WriteStreams,
  OutputContext,
  SuccessEnvelope,
  ErrorEnvelope,
  ResultEnvelope,
  ErrorCategory,
} from './types';

export { EXIT_CODES, type ExitCode, exitCodeForCategory } from './exitCodes';
export { CliError, errorToExit, type CliErrorArgs } from './errors';
export { ERROR_CODES, type KnownErrorCode, isKnownErrorCode } from './errorCodes';
export { defaultStreams, makeOutputContext } from './context';
export { writeBinary } from './binary';

import * as textRenderer from './text';
import * as jsonRenderer from './json';
import type { CliError as CliErrorType } from './errors';
import type { OutputContext } from './types';

export function renderSuccess<T>(ctx: OutputContext, data: T, humanText?: (data: T) => string): void {
  if (ctx.format === 'json') {
    jsonRenderer.renderSuccess(ctx, data);
    return;
  }
  textRenderer.renderSuccess(ctx, data, humanText);
}

export function renderError(ctx: OutputContext, error: CliErrorType | Error): void {
  if (ctx.format === 'json') {
    jsonRenderer.renderError(ctx, error);
    return;
  }
  textRenderer.renderError(ctx, error);
}
