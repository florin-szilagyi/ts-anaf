export type McpErrorCategory = 'config_missing' | 'auth' | 'anaf_api' | 'user_input' | 'internal';

export interface McpToolErrorOptions {
  code: string;
  message: string;
  category: McpErrorCategory;
  details?: Record<string, unknown>;
}

export class McpToolError extends Error {
  readonly code: string;
  readonly category: McpErrorCategory;
  readonly details?: Record<string, unknown>;

  constructor(opts: McpToolErrorOptions) {
    super(opts.message);
    this.name = 'McpToolError';
    this.code = opts.code;
    this.category = opts.category;
    this.details = opts.details;
  }
}

export function formatToolError(err: unknown): string {
  if (err instanceof McpToolError) {
    const detailStr = err.details ? ` (${JSON.stringify(err.details)})` : '';
    return `[${err.code}] ${err.message}${detailStr}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}
