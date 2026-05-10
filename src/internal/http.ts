import got, {
  HTTPError,
  RequestError,
  TimeoutError,
  type Got,
  type Method,
  type OptionsOfJSONResponseBody,
} from 'got';
import { SkinsharkError } from '../errors.js';
import { META_SYMBOL, type ResponseMeta } from '../meta.js';
import type { Envelope } from '../types/api.js';
import type { ErrorKey } from '../types/errors.js';

export interface SkinsharkClientOptions {
  apiKey: string;
  webhookSecret?: string;
  baseUrl?: string;
  userAgent?: string;
  timeoutMs?: number;
  retries?: false | { max?: number; baseDelayMs?: number };
  debug?: boolean | DebugHook;
}

export type DebugEvent =
  | { type: 'request'; method: string; url: string; headers: Record<string, string> }
  | { type: 'response'; method: string; url: string; status: number; durationMs: number; requestId?: string }
  | { type: 'retry'; method: string; url: string; attempt: number; reason: string }
  | { type: 'error'; method: string; url: string; key: string; status: number; requestId?: string };

export type DebugHook = (event: DebugEvent) => void;

export interface RequestOptions {
  onBehalfOf?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  retries?: false | { max?: number; baseDelayMs?: number };
  headers?: Record<string, string>;
}

interface CallContext extends Record<string, unknown> {
  onBehalfOf?: string | undefined;
  idempotencyKey?: string | undefined;
  startedAt?: number | undefined;
  debug?: DebugHook | undefined;
}

export type QueryParams = Record<string, string | number | boolean | undefined> | object;

export interface InternalRequestInit {
  query?: QueryParams | undefined;
  body?: unknown;
  opts?: RequestOptions | undefined;
}

const REDACTED = '<redacted>';
// Replaced at build time by tsup/vitest `define`. Stays in sync with package.json automatically.
declare const __SDK_VERSION__: string;
const SDK_VERSION = __SDK_VERSION__;

// Idempotent by HTTP semantics — safe to retry without an idempotency key.
const IDEMPOTENT_METHODS: Method[] = ['GET', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'];
// When the caller supplies an Idempotency-Key, retrying these is also safe.
const KEYED_RETRY_METHODS: Method[] = ['GET', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'POST', 'PATCH'];

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = k.toLowerCase() === 'api-key' ? REDACTED : v;
  }
  return out;
}

function parseRetryAfter(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function pickRateLimit(headers: Record<string, string | string[] | undefined>): ResponseMeta['rateLimit'] {
  const limit = headers['x-ratelimit-limit'];
  const remaining = headers['x-ratelimit-remaining'];
  const reset = headers['x-ratelimit-reset'];
  if (!limit && !remaining && !reset) return undefined;
  const out: NonNullable<ResponseMeta['rateLimit']> = {};
  if (typeof limit === 'string') out.limit = Number(limit);
  if (typeof remaining === 'string') out.remaining = Number(remaining);
  if (typeof reset === 'string') {
    // @fastify/rate-limit emits seconds-until-reset (relative), not Unix epoch.
    const s = Number(reset);
    if (Number.isFinite(s)) out.resetAt = new Date(Date.now() + s * 1000);
  }
  return out;
}

function buildSearchParams(query: QueryParams | undefined): Record<string, string> | undefined {
  if (!query) return undefined;
  let out: Record<string, string> | undefined;
  for (const k in query as Record<string, unknown>) {
    const v = (query as Record<string, unknown>)[k];
    if (v === undefined || v === null || v === '') continue;
    (out ??= {})[k] = String(v);
  }
  return out;
}

function makeResponseMeta(
  requestId: string,
  status: number,
  rawHeaders: Record<string, string | string[] | undefined>,
): ResponseMeta {
  const meta: ResponseMeta = {
    requestId,
    status,
    // Headers are computed on first access and cached. Most consumers never
    // read them, so the eager Object.fromEntries was wasted work.
    get headers(): Record<string, string> {
      const out: Record<string, string> = {};
      for (const k in rawHeaders) {
        const v = rawHeaders[k];
        out[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '');
      }
      Object.defineProperty(this, 'headers', { value: out, writable: false, configurable: false });
      return out;
    },
  } as ResponseMeta;
  const rl = pickRateLimit(rawHeaders);
  if (rl) meta.rateLimit = rl;
  return meta;
}

function attachMeta<T>(value: T, meta: ResponseMeta): T {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    Object.defineProperty(value as object, META_SYMBOL, {
      value: meta,
      enumerable: false,
      writable: false,
      configurable: true,
    });
  }
  return value;
}

export class HttpClient {
  readonly client: Got;
  readonly defaults: Pick<RequestOptions, 'onBehalfOf'>;
  private readonly debug: DebugHook | undefined;

  constructor(opts: SkinsharkClientOptions, defaults: Pick<RequestOptions, 'onBehalfOf'> = {}) {
    this.defaults = defaults;
    const baseUrl = (opts.baseUrl ?? 'https://api.skinshark.gg').replace(/\/+$/, '') + '/';
    const ua = opts.userAgent ?? `@skinshark/sdk/${SDK_VERSION} (+https://skinshark.gg)`;
    const apiKey = opts.apiKey;
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const retryCfg = opts.retries === false ? false : opts.retries ?? {};
    const debug = typeof opts.debug === 'function' ? opts.debug
      : opts.debug === true ? ((e: DebugEvent) => console.debug('[skinshark]', e))
      : undefined;
    this.debug = debug;

    this.client = got.extend({
      prefixUrl: baseUrl,
      responseType: 'json',
      throwHttpErrors: true,
      timeout: { request: timeoutMs },
      retry:
        retryCfg === false
          ? { limit: 0 }
          : {
              limit: retryCfg.max ?? 3,
              statusCodes: [408, 429, 500, 502, 503, 504],
              // Default to HTTP-idempotent methods only. Per-request retry
              // expands to POST/PATCH when an Idempotency-Key is present.
              methods: IDEMPOTENT_METHODS,
              backoffLimit: 8000,
              calculateDelay: ({ attemptCount, retryOptions, error, computedValue }) => {
                if (attemptCount > (retryOptions.limit ?? 3)) return 0;
                // Floor at 1ms — got treats 0 as "stop retrying".
                const retryAfter = parseRetryAfter(error.response?.headers['retry-after'] as string | undefined);
                if (retryAfter !== undefined) return Math.max(1, Math.min(retryAfter, 60_000));
                const base = retryCfg.baseDelayMs ?? 200;
                const exp = base * 2 ** (attemptCount - 1);
                const jitter = Math.random() * base;
                return Math.max(1, Math.min(exp + jitter, computedValue));
              },
            },
      hooks: {
        beforeRequest: [
          (options) => {
            const ctx = (options.context ?? {}) as CallContext;
            ctx.startedAt = Date.now();
            options.context = ctx;
            options.headers['api-key'] = apiKey;
            options.headers['user-agent'] = ua;
            options.headers['accept'] = 'application/json';
            if (ctx.onBehalfOf) options.headers['On-Behalf-Of'] = ctx.onBehalfOf;
            if (ctx.idempotencyKey) options.headers['Idempotency-Key'] = ctx.idempotencyKey;
            if (debug) {
              debug({
                type: 'request',
                method: String(options.method),
                url: String(options.url),
                headers: redactHeaders(options.headers as Record<string, string>),
              });
            }
          },
        ],
        beforeRetry: [
          (error, retryCount) => {
            if (debug) {
              debug({
                type: 'retry',
                method: String(error.options?.method ?? ''),
                url: String(error.options?.url ?? ''),
                attempt: retryCount ?? 0,
                reason: error.code ?? error.name,
              });
            }
          },
        ],
        afterResponse: [
          (response) => {
            const ctx = (response.request.options.context ?? {}) as CallContext;
            if (debug) {
              const env = response.body as Envelope<unknown> | undefined;
              debug({
                type: 'response',
                method: String(response.request.options.method),
                url: String(response.request.options.url),
                status: response.statusCode,
                durationMs: ctx.startedAt ? Date.now() - ctx.startedAt : 0,
                ...(env?.requestId !== undefined ? { requestId: env.requestId } : {}),
              });
            }
            return response;
          },
        ],
      },
    });
  }

  /**
   * Returns a thin proxy that injects default `onBehalfOf` (and any other
   * future defaults) into every request. Caller-supplied options still
   * override per call. Used by `sdk.as(id)` to bind a sub-user once.
   */
  withDefaults(defaults: Pick<RequestOptions, 'onBehalfOf'>): HttpClient {
    const proxy = Object.create(this) as HttpClient;
    Object.defineProperty(proxy, 'defaults', {
      value: { ...this.defaults, ...defaults },
      writable: false,
      configurable: false,
    });
    return proxy;
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    init: InternalRequestInit = {},
  ): Promise<T> {
    const mergedOpts: RequestOptions = { ...this.defaults, ...(init.opts ?? {}) };

    const ctx: CallContext = {
      onBehalfOf: mergedOpts.onBehalfOf,
      idempotencyKey: mergedOpts.idempotencyKey,
      debug: this.debug,
    };

    const searchParams = buildSearchParams(init.query);

    const requestOptions: OptionsOfJSONResponseBody = {
      method,
      context: ctx,
      ...(searchParams ? { searchParams } : {}),
      ...(init.body !== undefined ? { json: init.body as Record<string, unknown> } : {}),
      ...(mergedOpts.signal ? { signal: mergedOpts.signal } : {}),
      ...(mergedOpts.timeoutMs ? { timeout: { request: mergedOpts.timeoutMs } } : {}),
      ...(mergedOpts.headers ? { headers: mergedOpts.headers } : {}),
    };

    if (mergedOpts.retries === false) {
      requestOptions.retry = { limit: 0 };
    } else if (mergedOpts.retries) {
      requestOptions.retry = {
        limit: mergedOpts.retries.max ?? 3,
        ...(mergedOpts.idempotencyKey ? { methods: KEYED_RETRY_METHODS } : {}),
      };
    } else if (mergedOpts.idempotencyKey) {
      // Default retry config is in effect. Expand methods to include POST/PATCH
      // since the idempotency key makes a retry safe.
      requestOptions.retry = { methods: KEYED_RETRY_METHODS };
    }

    try {
      // Strip leading slash since got's prefixUrl expects relative paths.
      const relativePath = path.replace(/^\/+/, '');
      const response = await this.client(relativePath, requestOptions);
      const envelope = response.body as unknown as Envelope<T> | undefined;
      const requestId = envelope?.requestId ?? '';

      if (!envelope || envelope.success !== true) {
        const errInfo = envelope?.error;
        throw new SkinsharkError({
          code: errInfo?.code ?? 0,
          key: (errInfo?.key as ErrorKey | undefined) ?? 'SDK_INVALID_RESPONSE',
          message: errInfo?.message ?? 'Server returned an unsuccessful envelope',
          status: response.statusCode,
          requestId,
        });
      }

      const data = envelope.data;
      if (data === undefined || data === null) return data as T;
      return attachMeta(data, makeResponseMeta(requestId, response.statusCode, response.headers));
    } catch (e) {
      throw mapError(e, method, path, this.debug);
    }
  }
}

function mapError(
  e: unknown,
  method: string,
  path: string,
  debug: DebugHook | undefined,
): unknown {
  if (e instanceof SkinsharkError) {
    if (debug) {
      debug({
        type: 'error', method, url: path,
        key: e.key, status: e.status,
        ...(e.requestId !== undefined ? { requestId: e.requestId } : {}),
      });
    }
    return e;
  }

  if (e instanceof HTTPError) {
    const body = e.response.body as Envelope<unknown> | undefined;
    const status = e.response.statusCode;
    const errInfo = body?.error;
    const requestId = body?.requestId;
    const retryAfter = parseRetryAfter(e.response.headers['retry-after'] as string | undefined);
    const wrapped = new SkinsharkError({
      code: errInfo?.code ?? 0,
      key: (errInfo?.key as ErrorKey | undefined) ?? (status === 429 ? 'RATE_LIMITED' : 'SDK_INVALID_RESPONSE'),
      message: errInfo?.message ?? `HTTP ${status}`,
      status,
      requestId,
      retryAfterMs: retryAfter,
      cause: e,
    });
    if (debug) {
      debug({
        type: 'error', method, url: path,
        key: wrapped.key, status: wrapped.status,
        ...(wrapped.requestId !== undefined ? { requestId: wrapped.requestId } : {}),
      });
    }
    return wrapped;
  }

  if (e instanceof TimeoutError) {
    return new SkinsharkError({
      code: 0,
      key: 'SDK_TIMEOUT',
      message: 'Request timed out',
      cause: e,
    });
  }

  if (e instanceof RequestError) {
    const aborted = e.code === 'ERR_CANCELED' || (e.cause as Error | undefined)?.name === 'AbortError';
    return new SkinsharkError({
      code: 0,
      key: aborted ? 'SDK_ABORTED' : 'SDK_NETWORK',
      message: e.message,
      cause: e,
    });
  }

  return e;
}
