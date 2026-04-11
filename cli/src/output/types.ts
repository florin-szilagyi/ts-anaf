export type OutputFormat = 'text' | 'json';

export interface WriteStreams {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export interface OutputContext {
  format: OutputFormat;
  streams: WriteStreams;
}

export interface SuccessEnvelope<T> {
  success: true;
  data: T;
}

export interface ErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ResultEnvelope<T> = SuccessEnvelope<T> | ErrorEnvelope;

export type ErrorCategory = 'generic' | 'user_input' | 'auth' | 'anaf_api' | 'local_state';
