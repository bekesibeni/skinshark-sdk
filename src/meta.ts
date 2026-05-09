// Cross-realm safe (Symbol.for) so consumers can read it from any module copy.
export const META_SYMBOL: unique symbol = Symbol.for('@skinshark/sdk.meta') as never;

export interface ResponseMeta {
  requestId: string;
  status: number;
  /** Lazily computed on first access. */
  headers: Record<string, string>;
  rateLimit?: {
    limit?: number;
    remaining?: number;
    resetAt?: Date;
  };
}

/**
 * Read response metadata attached by the SDK. Returns `undefined` for primitive
 * results (e.g. DELETE returning null) since there's nowhere to attach meta.
 */
export function meta(value: unknown): ResponseMeta | undefined {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    return (value as { [k: symbol]: ResponseMeta | undefined })[META_SYMBOL];
  }
  return undefined;
}
