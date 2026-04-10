export class AnafSdkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, AnafSdkError.prototype);
  }
}

export class AnafValidationError extends AnafSdkError {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, AnafValidationError.prototype);
  }
}

export class AnafNotFoundError extends AnafSdkError {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, AnafNotFoundError.prototype);
  }
}

export class AnafAuthenticationError extends AnafSdkError {
  constructor(message: string = 'Authentication failed. Check your credentials or token.') {
    super(message);
    Object.setPrototypeOf(this, AnafAuthenticationError.prototype);
  }
}

export class AnafApiError extends AnafSdkError {
  public statusCode?: number;
  public details?: any;

  constructor(message: string, statusCode?: number, details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, AnafApiError.prototype);
  }
}

export class AnafRateLimitError extends AnafSdkError {
  constructor(message: string = 'Rate limit exceeded. ANAF allows 1000 requests per minute.') {
    super(message);
    Object.setPrototypeOf(this, AnafRateLimitError.prototype);
  }
}

export class AnafXmlParsingError extends AnafSdkError {
  public rawResponse?: string;

  constructor(message: string, rawResponse?: string) {
    super(message);
    this.rawResponse = rawResponse;
    Object.setPrototypeOf(this, AnafXmlParsingError.prototype);
  }
}

export class AnafUnexpectedResponseError extends AnafSdkError {
  public responseData?: any;

  constructor(message: string = 'The API returned an unexpected response format.', responseData?: any) {
    super(message);
    this.responseData = responseData;
    Object.setPrototypeOf(this, AnafUnexpectedResponseError.prototype);
  }
}
