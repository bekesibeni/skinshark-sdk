import type {
  HttpClient,
  QueryParams,
  RawFetchInit,
  RawResponse,
  RequestOptions,
} from '../internal/http.js';

export type RawMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export interface RawFetchRequestInit extends RawFetchInit {
  /** Defaults to GET. */
  method?: RawMethod;
  path: string;
}

export interface RawRequestInit {
  method: RawMethod;
  path: string;
  query?: QueryParams;
  body?: unknown;
  opts?: RequestOptions;
}

/**
 * Untyped escape hatch for endpoints this SDK doesn't wrap — internal routes,
 * unreleased ones, anything added after the last release. Goes through the same
 * pipeline as every typed method: `api-key`, `On-Behalf-Of`, `Idempotency-Key`,
 * retries, envelope unwrap (you get `data`, not the envelope), `SkinsharkError`
 * mapping and `meta()`.
 *
 * `T` defaults to `unknown` so callers narrow deliberately; pass a shape when
 * you have one. Paths are relative to the base URL — a leading slash is fine.
 */
export class RawModule {
  constructor(private readonly http: HttpClient) {}

  get<T = unknown>(path: string, query?: QueryParams, opts?: RequestOptions): Promise<T> {
    return this.http.request<T>('GET', path, { query, opts });
  }

  post<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.http.request<T>('POST', path, { body, opts });
  }

  put<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.http.request<T>('PUT', path, { body, opts });
  }

  patch<T = unknown>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.http.request<T>('PATCH', path, { body, opts });
  }

  delete<T = unknown>(path: string, opts?: RequestOptions): Promise<T> {
    return this.http.request<T>('DELETE', path, { opts });
  }

  /**
   * Envelope-free fetch: status, headers and the body as sent. For routes that don't return
   * `{ success, data }` — artifact exports, NDJSON, anything that hijacks the reply. Set
   * `acceptStatus: [304]` to poll an ETag without a conditional hit throwing.
   */
  fetch<B extends string | Buffer = string>(init: RawFetchRequestInit): Promise<RawResponse<B>> {
    return this.http.fetchRaw<B>(init.method ?? 'GET', init.path, init);
  }

  /** Full control — the only form that takes a query string and a body together. */
  request<T = unknown>(init: RawRequestInit): Promise<T> {
    return this.http.request<T>(init.method, init.path, {
      query: init.query,
      body: init.body,
      opts: init.opts,
    });
  }
}
