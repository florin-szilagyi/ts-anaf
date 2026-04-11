import type { ErrorCategory } from './types';

export const EXIT_CODES = {
  SUCCESS: 0,
  GENERIC_FAILURE: 1,
  USER_INPUT: 2,
  AUTH: 3,
  ANAF_API: 4,
  LOCAL_STATE: 5,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

const CATEGORY_EXIT: Record<ErrorCategory, ExitCode> = {
  generic: EXIT_CODES.GENERIC_FAILURE,
  user_input: EXIT_CODES.USER_INPUT,
  auth: EXIT_CODES.AUTH,
  anaf_api: EXIT_CODES.ANAF_API,
  local_state: EXIT_CODES.LOCAL_STATE,
};

export function exitCodeForCategory(category: ErrorCategory): ExitCode {
  return CATEGORY_EXIT[category];
}
