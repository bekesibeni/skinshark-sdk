export { Skinshark } from './client.js';
export type {
  SkinsharkClientOptions,
  RequestOptions,
  Envelope,
} from './client.js';

export { ScopedClient } from './modules/scoped.js';
export type { BuyOptions } from './modules/market.js';

export type { DebugEvent, DebugHook } from './internal/http.js';

export {
  SkinsharkError,
  isError,
  isAuthError,
  isRateLimited,
  isValidationError,
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
