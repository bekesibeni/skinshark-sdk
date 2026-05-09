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

  /** `id` accepts trade UUID or your trade externalId. */
  get(id: TradeRef, opts?: RequestOptions): Promise<Trade> {
    return this.http.request<Trade>('GET', `merchant/trades/${encodeURIComponent(id)}`, { opts });
  }
}
