import {
  AUTH_ERROR_KEYS,
  RATE_LIMIT_ERROR_KEYS,
  VALIDATION_ERROR_KEYS,
  type ErrorKey,
} from './types/errors.js';

export interface SkinsharkErrorInit {
  code: number;
  key: ErrorKey;
  message: string;
  status?: number;
  requestId?: string | undefined;
  retryAfterMs?: number | undefined;
  meta?: Record<string, unknown> | undefined;
  cause?: unknown;
}

export class SkinsharkError extends Error {
  override readonly name = 'SkinsharkError';
  readonly code: number;
  readonly key: ErrorKey;
  readonly status: number;
  readonly requestId: string | undefined;
  readonly retryAfterMs: number | undefined;
  readonly meta: Record<string, unknown> | undefined;

  constructor(init: SkinsharkErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.code = init.code;
    this.key = init.key;
    this.status = init.status ?? 0;
    this.requestId = init.requestId;
    this.retryAfterMs = init.retryAfterMs;
    this.meta = init.meta;
  }
}

// Narrowing guard: checks instance + optional key match.
export function isError<K extends ErrorKey>(
  e: unknown,
  key?: K,
): e is SkinsharkError & { key: K } {
  if (!(e instanceof SkinsharkError)) return false;
  if (key === undefined) return true;
  return e.key === key;
}

export function isAuthError(e: unknown): e is SkinsharkError {
  return e instanceof SkinsharkError && AUTH_ERROR_KEYS.has(e.key);
}

export function isRateLimited(e: unknown): e is SkinsharkError {
  return e instanceof SkinsharkError && RATE_LIMIT_ERROR_KEYS.has(e.key);
}

export function isValidationError(e: unknown): e is SkinsharkError {
  return e instanceof SkinsharkError && VALIDATION_ERROR_KEYS.has(e.key);
}
