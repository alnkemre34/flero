import type { ErrorCode } from '@flero/contracts';

/**
 * Domain error rendered as RFC 9457 problem+json with a stable `code` (doc 07 §1). Never carries hidden-thread
 * state, counter values or internal ids.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly params: Record<string, string | number> | undefined;
  constructor(code: ErrorCode, status: number, params?: Record<string, string | number>) {
    super(code);
    this.code = code;
    this.status = status;
    this.params = params;
  }
}

export const err = {
  validation: (params?: Record<string, string | number>) => new AppError('VALIDATION_FAILED', 400, params),
  unauthenticated: () => new AppError('UNAUTHENTICATED', 401),
  unavailable: () => new AppError('ACTION_UNAVAILABLE', 403), // one code for blocked/suspended/deleted/hidden (O10)
  notFound: () => new AppError('NOT_FOUND', 404),
  conflict: (code: ErrorCode, params?: Record<string, string | number>) => new AppError(code, 409, params),
  payment: (code: ErrorCode = 'INSUFFICIENT_GOLD', params?: Record<string, string | number>) => new AppError(code, 402, params),
  rateLimited: () => new AppError('RATE_LIMITED', 429),
  retryable: () => new AppError('TEMPORARILY_UNAVAILABLE', 503),
};

export function problem(e: AppError, requestId: string) {
  return {
    type: `https://errors.flero.app/${e.code.toLowerCase()}`,
    code: e.code,
    status: e.status,
    title_key: `error.${e.code.toLowerCase()}`,
    ...(e.params ? { params: e.params } : {}),
    request_id: requestId,
  };
}
