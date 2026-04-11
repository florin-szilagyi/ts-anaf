import { CliError, errorToExit } from '../../src/output/errors';
import { EXIT_CODES } from '../../src/output/exitCodes';

describe('CliError', () => {
  it('captures code, message, category, and details', () => {
    const err = new CliError({
      code: 'AUTH_FAILED',
      message: 'token expired',
      category: 'auth',
      details: { context: 'acme-prod' },
    });
    expect(err.code).toBe('AUTH_FAILED');
    expect(err.message).toBe('token expired');
    expect(err.category).toBe('auth');
    expect(err.details).toEqual({ context: 'acme-prod' });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CliError');
  });

  it('preserves stack trace', () => {
    const err = new CliError({ code: 'X', message: 'y', category: 'generic' });
    expect(err.stack).toBeDefined();
  });
});

describe('errorToExit', () => {
  it('maps each CliError category to its exit code', () => {
    const cases: Array<[Parameters<typeof errorToExit>[0], number]> = [
      [new CliError({ code: 'A', message: 'a', category: 'generic' }), EXIT_CODES.GENERIC_FAILURE],
      [new CliError({ code: 'B', message: 'b', category: 'user_input' }), EXIT_CODES.USER_INPUT],
      [new CliError({ code: 'C', message: 'c', category: 'auth' }), EXIT_CODES.AUTH],
      [new CliError({ code: 'D', message: 'd', category: 'anaf_api' }), EXIT_CODES.ANAF_API],
      [new CliError({ code: 'E', message: 'e', category: 'local_state' }), EXIT_CODES.LOCAL_STATE],
    ];
    for (const [err, expected] of cases) {
      expect(errorToExit(err)).toBe(expected);
    }
  });

  it('maps a plain Error to GENERIC_FAILURE', () => {
    expect(errorToExit(new Error('boom'))).toBe(EXIT_CODES.GENERIC_FAILURE);
  });
});
