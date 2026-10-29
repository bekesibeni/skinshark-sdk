export { Skinshark } from './client.js';
export type {
  SkinsharkClientOptions,
  RequestOptions,
  Envelope,
} from './client.js';

export { ScopedClient } from './modules/scoped.js';
export type { BuyOptions, SellOptions } from './modules/market.js';
export type {
  LiveConnection,
  LiveOptions,
  MarketWatch,
  MarketWatchHandlers,
  MarketRemovalsHandlers,
  WebSocketConstructor,
} from './modules/live.js';

export { loadBook } from './modules/book.js';
export type {
  BookExport,
  BookExportOptions,
  LoadBookOptions,
  LoadedBook,
  SyncBookHandlers,
  SyncBookOptions,
  SyncedBook,
} from './modules/book.js';
export { applyBookFrame, decodeBookFrame } from './modules/bookCodec.js';
export type {
  BookListing,
  BookPriceChange,
  BookRemoval,
  BookTop,
  BookFrame,
  BookPosition,
  WireBookFrame,
} from './modules/bookCodec.js';
export { decodeStreamMessage } from './modules/bookStream.js';
export type { BookStream, BookStreamHandlers, BookStreamOptions } from './modules/bookStream.js';

export { RawModule } from './modules/raw.js';
export type { RawMethod, RawRequestInit, RawFetchRequestInit } from './modules/raw.js';

export type {
  DebugEvent,
  DebugHook,
  QueryParams,
  RawFetchInit,
  RawResponse,
} from './internal/http.js';

export {
  SkinsharkError,
  isError,
  isAuthError,
  isRateLimited,
  isValidationError,
  isTransient,
} from './errors.js';
export type { SkinsharkErrorInit } from './errors.js';

export { meta } from './meta.js';
export type { ResponseMeta } from './meta.js';

export { verifyWebhook } from './webhooks.js';
export type { VerifyWebhookOptions } from './webhooks.js';

export type { ErrorKey } from './types/errors.js';

// Wire types at the root entry too. The /types subpath remains available for
// type-only imports without runtime cost.
export type * from './types/api.js';
export type * from './types/branded.js';
export type * from './types/webhooks.js';
