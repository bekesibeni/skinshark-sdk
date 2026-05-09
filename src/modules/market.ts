import type { HttpClient, RequestOptions } from '../internal/http.js';
import type {
  SuggestionsResponse, SearchResponse, ItemDetailResponse,
  ListingsResponse, MarketListing,
  BuyItem, BuyResponse, QuickBuyBody, QuickBuyResponse,
  TransactionListResponse, Trade, CancelItemResponse,
  SearchQuery, ListListingsQuery, ListMarketTradesQuery,
} from '../types/api.js';
import type { ListingId, ItemId, TradeRef } from '../types/branded.js';

export interface BuyOptions extends RequestOptions {
  tradeUrl?: string;
}

export class MarketTradesModule {
  constructor(private readonly http: HttpClient) {}

  /** Actor's own trades, page-paginated. */
  list(query?: ListMarketTradesQuery, opts?: RequestOptions): Promise<TransactionListResponse> {
    return this.http.request<TransactionListResponse>('GET', 'market/trades', { query, opts });
  }

  get(tradeId: TradeRef, opts?: RequestOptions): Promise<Trade> {
    return this.http.request<Trade>('GET', `market/trades/${encodeURIComponent(tradeId)}`, { opts });
  }

  /** Best-effort — marketplace must accept the cancel; check response.status. */
  cancelItem(tradeId: TradeRef, itemId: string, opts?: RequestOptions): Promise<CancelItemResponse> {
    return this.http.request<CancelItemResponse>(
      'POST',
      `market/trades/${encodeURIComponent(tradeId)}/items/${encodeURIComponent(itemId)}/cancel`,
      { opts },
    );
  }
}

export class MarketModule {
  readonly trades: MarketTradesModule;

  constructor(private readonly http: HttpClient) {
    this.trades = new MarketTradesModule(http);
  }

  /** Type-ahead suggestions for catalog items. */
  suggest(q: string, opts?: RequestOptions): Promise<SuggestionsResponse> {
    return this.http.request<SuggestionsResponse>('GET', 'market/search/suggestions', { query: { q }, opts });
  }

  /** Page-paginated catalog search; returns canonical items, not live offers. */
  search(query?: SearchQuery, opts?: RequestOptions): Promise<SearchResponse> {
    return this.http.request<SearchResponse>('GET', 'market/search', { query, opts });
  }

  /** Item detail with per-marketplace price + count overview. */
  item(itemId: ItemId | string, opts?: RequestOptions): Promise<ItemDetailResponse> {
    return this.http.request<ItemDetailResponse>('GET', `market/items/${encodeURIComponent(itemId)}`, { opts });
  }

  /** Live cross-marketplace offers for an item. */
  listings(
    itemId: ItemId | string,
    query?: ListListingsQuery,
    opts?: RequestOptions,
  ): Promise<ListingsResponse> {
    return this.http.request<ListingsResponse>(
      'GET', `market/items/${encodeURIComponent(itemId)}/listings`, { query, opts },
    );
  }

  /** Refresh a single listing's price/availability before buying. */
  listing(listingId: ListingId | string, opts?: RequestOptions): Promise<MarketListing> {
    return this.http.request<MarketListing>('GET', `market/listings/${encodeURIComponent(listingId)}`, { opts });
  }

  /**
   * POST /market/buy — buy specific listings (1–10).
   *
   * @param items 1–10 listing references with per-item maxPrice ceiling.
   * @param externalId Your correlation id, echoed back on the Trade.
   * @param opts onBehalfOf, tradeUrl override, signal, headers.
   */
  buy(
    items: BuyItem[],
    externalId?: string,
    opts?: BuyOptions,
  ): Promise<BuyResponse> {
    const body: { items: BuyItem[]; externalId?: string; tradeUrl?: string } = { items };
    if (externalId !== undefined) body.externalId = externalId;
    if (opts?.tradeUrl !== undefined) body.tradeUrl = opts.tradeUrl;
    return this.http.request<BuyResponse>('POST', 'market/buy', { body, opts });
  }

  /**
   * POST /market/buy/quick — server picks N cheapest listings ≤ maxPrice.
   *
   * @param body itemId, maxPrice, amount, delivery.
   * @param externalId Your correlation id.
   * @param opts onBehalfOf, tradeUrl override.
   */
  quickBuy(
    body: Omit<QuickBuyBody, 'externalId' | 'tradeUrl'>,
    externalId?: string,
    opts?: BuyOptions,
  ): Promise<QuickBuyResponse> {
    const fullBody: QuickBuyBody = { ...body };
    if (externalId !== undefined) fullBody.externalId = externalId;
    if (opts?.tradeUrl !== undefined) fullBody.tradeUrl = opts.tradeUrl;
    return this.http.request<QuickBuyResponse>('POST', 'market/buy/quick', { body: fullBody, opts });
  }
}
