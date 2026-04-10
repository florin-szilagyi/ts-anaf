import { AnafSdkError } from '../errors';

/**
 * Re-throw SDK errors as-is; wrap unexpected errors with context.
 * HttpClient already maps HTTP status codes to typed SDK errors,
 * so this only handles the fallthrough case.
 */
export function handleApiError(error: any, context: string): never {
  if (error instanceof AnafSdkError) {
    throw error;
  }
  throw new AnafSdkError(`${context}: ${error.message || 'Unknown error'}`);
}
