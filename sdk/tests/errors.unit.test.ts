import {
  AnafAmbiguousTaxTotalError,
  AnafApiError,
  AnafAuthenticationError,
  AnafNotFoundError,
  AnafRateLimitError,
  AnafSdkError,
  AnafUnexpectedResponseError,
  AnafValidationError,
  AnafXmlParsingError,
} from '../src/errors';

describe('error names', () => {
  // A literal survives a consumer's minifier; `this.constructor.name` does not.
  it.each([
    ['AnafSdkError', new AnafSdkError('x')],
    ['AnafValidationError', new AnafValidationError('x')],
    ['AnafNotFoundError', new AnafNotFoundError('x')],
    ['AnafAuthenticationError', new AnafAuthenticationError()],
    ['AnafApiError', new AnafApiError('x', 500)],
    ['AnafRateLimitError', new AnafRateLimitError()],
    ['AnafXmlParsingError', new AnafXmlParsingError('x')],
    ['AnafUnexpectedResponseError', new AnafUnexpectedResponseError()],
    ['AnafAmbiguousTaxTotalError', new AnafAmbiguousTaxTotalError('x')],
  ])('%s carries its own name', (name, error) => {
    expect(error.name).toBe(name);
    expect(error).toBeInstanceOf(AnafSdkError);
  });

  it('keeps the literal name when the class itself is renamed', () => {
    const Renamed = AnafApiError;
    Object.defineProperty(Renamed, 'name', { value: 's' });
    try {
      expect(new Renamed('x').name).toBe('AnafApiError');
    } finally {
      Object.defineProperty(Renamed, 'name', { value: 'AnafApiError' });
    }
  });
});
