import { exitCodeForCategory, EXIT_CODES, type ExitCode } from './exitCodes';
import type { ErrorCategory } from './types';

export interface CliErrorArgs {
  code: string;
  message: string;
  category: ErrorCategory;
  details?: Record<string, unknown>;
}

export class CliError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly details?: Record<string, unknown>;

  constructor(args: CliErrorArgs) {
    super(args.message);
    this.name = 'CliError';
    this.code = args.code;
    this.category = args.category;
    this.details = args.details;
  }
}

export function errorToExit(error: CliError | Error): ExitCode {
  if (error instanceof CliError) {
    return exitCodeForCategory(error.category);
  }
  return EXIT_CODES.GENERIC_FAILURE;
}
