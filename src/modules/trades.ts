import type { HttpClient, RequestOptions } from '../internal/http.js';
import type { Trade, MerchantTradeListResponse, ListMerchantTradesQuery } from '../types/api.js';
import type { TradeRef } from '../types/branded.js';

/** Merchant-only aggregate trade view. Cursor-paginated. */
export class TradesModule {
  constructor(private readonly http: HttpClient) {}

  /** Cross sub-user, cursor-paginated. */
  list(query?: ListMerchantTradesQuery, opts?: RequestOptions): Promise<MerchantTradeListResponse> {
    return this.http.request<MerchantTradeListResponse>('GET', 'merchant/trades', { query, opts });
  }

  /** Resolve trades by UUID or your externalId — always an array (pass a single id as `[id]`, up to
   *  100). Unresolved refs are simply absent from the result, so a reconciliation poller gets
   *  whatever exists. */
  get(ids: TradeRef[], opts?: RequestOptions): Promise<Trade[]> {
    if (ids.length === 0) return Promise.resolve([]);
    const path = ids.map(encodeURIComponent).join(',');
    return this.http
      .request<Trade | Trade[]>('GET', `merchant/trades/${path}`, { opts })
      .then((r) => (Array.isArray(r) ? r : [r]));
  }
}
