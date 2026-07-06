import { NextResponse } from 'next/server';
import { ApiError, isApiError } from '../errors';

/** Success envelope — mirrors the CLI JSON contract. */
export function ok<T>(data: T, init: { status?: number; headers?: Record<string, string> } = {}): NextResponse {
  return NextResponse.json({ success: true, data }, { status: init.status ?? 200, headers: init.headers });
}

export function fail(error: ApiError): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
    },
    { status: error.status, headers: error.headers }
  );
}

/** Wrap an unknown thrown value into a response without leaking internals. */
export function failFromUnknown(cause: unknown): NextResponse {
  if (isApiError(cause)) return fail(cause);
  console.error('[fastbill] unhandled API error:', cause);
  return fail(new ApiError({ code: 'INTERNAL', message: 'Internal error' }));
}
