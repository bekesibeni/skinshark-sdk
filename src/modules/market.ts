import type { HttpClient, RequestOptions } from '../internal/http.js';
import type {
  SuggestionsResponse, SearchResponse, ItemDetailResponse,
  ListingsResponse, MarketListing,
  BuyItem, BuyResponse, QuickBuyBody, QuickBuyResponse,
  TransactionListResponse, Trade, CancelItemResponse,
  SearchQuery, ListListingsQuery, ListMarketTradesQuery,
  MarketPricesQuery, MarketPricesResponse,
  MarketLiveQuery,
  SellItem, SellBody, SellResponse, SellInventory, SellInventoryQuery,
  SellPricesQuery, SellPricesResponse,
} from '../types/api.js';
import type { ListingId, ItemId, TradeRef } from '../types/branded.js';

export interface BuyOptions extends RequestOptions {
  tradeUrl?: string;
}

export interface SellOptions extends RequestOptions {
  tradeUrl?: string;
}

export class MarketTradesModule {
  constructor(private readonly http: HttpClient) {}

  /** Actor's own trades, cursor-paginated. */
  list(query?: ListMarketTradesQuery, opts?: RequestOptions): Promise<TransactionListResponse> {
    return this.http.request<TransactionListResponse>('GET', 'market/transactions', { query, opts });
  }

  /** Resolve the actor's trades by UUID or your externalId — always an array (pass a single id as
   *  `[id]`, up to 100). Unresolved refs are simply absent from the result, so a reconciliation
   *  poller gets whatever exists. */
  get(ids: TradeRef[], opts?: RequestOptions): Promise<Trade[]> {
    if (ids.length === 0) return Promise.resolve([]);
    const path = ids.map(encodeURIComponent).join(',');
    return this.http
      .request<Trade | Trade[]>('GET', `market/transactions/${path}`, { opts })
      .then((r) => (Array.isArray(r) ? r : [r]));
  }

  /** Best-effort — marketplace must accept the cancel; check response.status. */
  cancelItem(tradeId: TradeRef, itemId: string, opts?: RequestOptions): Promise<CancelItemResponse> {
    return this.http.request<CancelItemResponse>(
      'POST',
      `market/transactions/${encodeURIComponent(tradeId)}/items/${encodeURIComponent(itemId)}/cancel`,
      { opts },
    );
  }
}

/** Sell inventory items to a SkinShark bot for a house-funded payout. See the Selling guide. */
export class MarketSellModule {
  constructor(private readonly http: HttpClient) {}

  /** GET market/sell/prices — the payout book ("what we pay"), keyed by market hash name. */
  prices(query?: SellPricesQuery, opts?: RequestOptions): Promise<SellPricesResponse> {
    return this.http.request<SellPricesResponse>('GET', 'market/sell/prices', { query, opts });
  }

  /** GET market/sell/inventory — the user's CS2 inventory priced for selling. Only `accepted` items can be sold. */
  inventory(query?: SellInventoryQuery, opts?: RequestOptions): Promise<SellInventory> {
    return this.http.request<SellInventory>('GET', 'market/sell/inventory', { query, opts });
  }

  /**
   * POST /market/sell — sell items to a bot (1–100).
   *
   * @param items Each references an item by `id` (from `inventory()`) or `assetid` — exactly one —
   *   plus the exact quoted `price` (cent-exact lock).
   * @param externalId Your correlation id, echoed back on the Trade.
   * @param opts onBehalfOf, tradeUrl override, signal, headers.
   */
  create(
    items: SellItem[],
    externalId?: string,
    opts?: SellOptions,
  ): Promise<SellResponse> {
    const body: SellBody = { items };
    if (externalId !== undefined) body.externalId = externalId;
    if (opts?.tradeUrl !== undefined) body.tradeUrl = opts.tradeUrl;
    return this.http.request<SellResponse>('POST', 'market/sell', { body, opts });
  }
}

export class MarketModule {
  readonly trades: MarketTradesModule;
  readonly sell: MarketSellModule;

  constructor(private readonly http: HttpClient) {
    this.trades = new MarketTradesModule(http);
    this.sell = new MarketSellModule(http);
  }

  /** Type-ahead suggestions for catalog items. */
  suggest(q: string, opts?: RequestOptions): Promise<SuggestionsResponse> {
    return this.http.request<SuggestionsResponse>('GET', 'market/search/suggestions', { query: { q }, opts });
  }

  /** Page-paginated catalog search; returns canonical items, not live offers. */
  search(query?: SearchQuery, opts?: RequestOptions): Promise<SearchResponse> {
    return this.http.request<SearchResponse>('GET', 'market/search', { query, opts });
  }

  /** Bulk per-item floors: instant (C5 auto-deliver) + standard, after fee. `limit: -1` returns the whole catalog. Merchant account only — not available via On-Behalf-Of. */
  prices(query?: MarketPricesQuery, opts?: RequestOptions): Promise<MarketPricesResponse> {
    return this.http.request<MarketPricesResponse>('GET', 'market/prices', { query, opts });
  }

  /** Curated live-market snapshot: cheapest live listings across the watched items, cheapest-first, after fee. `limit: -1` returns the whole feed. */
  live(query?: MarketLiveQuery, opts?: RequestOptions): Promise<ListingsResponse> {
    return this.http.request<ListingsResponse>('GET', 'market', { query, opts });
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
