import type { HttpClient, RequestOptions } from '../internal/http.js';
import type {
  AddTradeUrlBody, UpdateTradeUrlBody, TradeUrlResponse, TradeUrlListResponse,
} from '../types/api.js';
import type { TradeUrlId } from '../types/branded.js';

export class TradeUrlsModule {
  constructor(private readonly http: HttpClient) {}

  list(opts?: RequestOptions): Promise<TradeUrlListResponse> {
    return this.http.request<TradeUrlListResponse>('GET', 'user/settings/tradeurls', { opts });
  }

  /** Server resolves Steam profile + persona; can fail with TRADEURL_INVALID_TOKEN / TRADEURL_ESCROW. */
  add(body: AddTradeUrlBody, opts?: RequestOptions): Promise<TradeUrlResponse> {
    return this.http.request<TradeUrlResponse>('POST', 'user/settings/tradeurls', { body, opts });
  }

  /** Rotate URL or flip primary. Provide at least one of `url` or `isPrimary`. */
  update(id: TradeUrlId | string, body: UpdateTradeUrlBody, opts?: RequestOptions): Promise<TradeUrlResponse> {
    return this.http.request<TradeUrlResponse>(
      'PATCH', `user/settings/tradeurls/${encodeURIComponent(id)}`, { body, opts },
    );
  }

  delete(id: TradeUrlId | string, opts?: RequestOptions): Promise<null> {
    return this.http.request<null>('DELETE', `user/settings/tradeurls/${encodeURIComponent(id)}`, { opts });
  }
}
