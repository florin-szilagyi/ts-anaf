/*
 * Every class names itself with a literal, never `this.constructor.name`: a
 * consumer that minifies its bundle renames the class, and the name its logs
 * and error tracker show would become a single letter.
 */
export class AnafSdkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnafSdkError';
    Object.setPrototypeOf(this, AnafSdkError.prototype);
  }
}

export class AnafValidationError extends AnafSdkError {
  constructor(message: string) {
    super(message);
    this.name = 'AnafValidationError';
    Object.setPrototypeOf(this, AnafValidationError.prototype);
  }
}

export class AnafNotFoundError extends AnafSdkError {
  constructor(message: string) {
    super(message);
    this.name = 'AnafNotFoundError';
    Object.setPrototypeOf(this, AnafNotFoundError.prototype);
  }
}

export class AnafAuthenticationError extends AnafSdkError {
  constructor(message: string = 'Authentication failed. Check your credentials or token.') {
    super(message);
    this.name = 'AnafAuthenticationError';
    Object.setPrototypeOf(this, AnafAuthenticationError.prototype);
  }
}

export class AnafApiError extends AnafSdkError {
  public statusCode?: number;
  public details?: any;

  constructor(message: string, statusCode?: number, details?: any) {
    super(message);
    this.name = 'AnafApiError';
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, AnafApiError.prototype);
  }
}

export class AnafRateLimitError extends AnafSdkError {
  constructor(message: string = 'Rate limit exceeded. ANAF allows 1000 requests per minute.') {
    super(message);
    this.name = 'AnafRateLimitError';
    Object.setPrototypeOf(this, AnafRateLimitError.prototype);
  }
}

export class AnafXmlParsingError extends AnafSdkError {
  public rawResponse?: string;

  constructor(message: string, rawResponse?: string) {
    super(message);
    this.name = 'AnafXmlParsingError';
    this.rawResponse = rawResponse;
    Object.setPrototypeOf(this, AnafXmlParsingError.prototype);
  }
}

export class AnafUnexpectedResponseError extends AnafSdkError {
  public responseData?: any;

  constructor(message: string = 'The API returned an unexpected response format.', responseData?: any) {
    super(message);
    this.name = 'AnafUnexpectedResponseError';
    this.responseData = responseData;
    Object.setPrototypeOf(this, AnafUnexpectedResponseError.prototype);
  }
}

/**
 * A received document carries several VAT totals and none of them uniquely
 * matches the document currency, so the correct one cannot be chosen without
 * guessing. Narrower than {@link AnafValidationError} on purpose: the
 * document is otherwise well-formed and only the VAT total is ambiguous.
 */
export class AnafAmbiguousTaxTotalError extends AnafValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'AnafAmbiguousTaxTotalError';
    Object.setPrototypeOf(this, AnafAmbiguousTaxTotalError.prototype);
  }
}
