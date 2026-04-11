import { ERROR_CODES, isKnownErrorCode } from '../../src/output/errorCodes';

describe('ERROR_CODES registry', () => {
  it('has entries for every ErrorCategory', () => {
    expect(Object.keys(ERROR_CODES).sort()).toEqual(['anaf_api', 'auth', 'generic', 'local_state', 'user_input']);
  });

  it('codes are unique across all categories', () => {
    const seen = new Set<string>();
    for (const [category, codes] of Object.entries(ERROR_CODES)) {
      for (const code of codes) {
        if (seen.has(code)) {
          throw new Error(`Duplicate error code "${code}" (seen again in category "${category}")`);
        }
        seen.add(code);
      }
    }
  });

  it('codes are SCREAMING_SNAKE_CASE', () => {
    for (const list of Object.values(ERROR_CODES)) {
      for (const code of list) {
        expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    }
  });

  it('isKnownErrorCode recognizes registered codes', () => {
    expect(isKnownErrorCode('AUTH_FAILED')).toBe(true);
    expect(isKnownErrorCode('CONTEXT_NOT_FOUND')).toBe(true);
    expect(isKnownErrorCode('BAD_USAGE')).toBe(true);
  });

  it('isKnownErrorCode rejects unknown codes', () => {
    expect(isKnownErrorCode('TOTALLY_MADE_UP')).toBe(false);
    expect(isKnownErrorCode('')).toBe(false);
  });
});
