import type { HttpClient, RequestOptions } from '../internal/http.js';
import { newIdempotencyKey } from '../internal/idempotency.js';
import {
  marketRemovals,
  watchMarket,
  type LiveConnection,
  type LiveOptions,
  type MarketRemovalsHandlers,
  type MarketWatch,
  type MarketWatchHandlers,
} from './live.js';
import type {
  SuggestionsResponse, SearchResponse, ItemDetailResponse,
  ListingsResponse, MarketListing,
  BuyItem, BuyResponse, QuickBuyBody, QuickBuyResponse,
  TransactionListResponse, Trade, CancelItemResponse, CancelTradeResponse,
  SearchQuery, ListListingsQuery, ListMarketTradesQuery,
  MarketPricesQuery, MarketPricesResponse,
  MarketLiveQuery, MarketFeedResponse,
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

// The API replays a buy by its externalId, so that is the key a retry must carry. One is minted
// when the caller gave neither, and the Idempotency-Key header makes got retry the POST.
function idempotentBuy(
  externalId: string | undefined,
  opts: BuyOptions | undefined,
): { externalId: string; opts: BuyOptions } {
  const key = externalId ?? opts?.idempotencyKey ?? newIdempotencyKey();
  return { externalId: key, opts: { ...opts, idempotencyKey: opts?.idempotencyKey ?? key } };
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

  /** Best-effort — marketplace must accept the cancel; check response.status.
   *  `itemId` is `TradeItem.id` or your own per-item `externalId`. */
  cancelItem(tradeId: TradeRef, itemId: string, opts?: RequestOptions): Promise<CancelItemResponse> {
    return this.http.request<CancelItemResponse>(
      'POST',
      `market/transactions/${encodeURIComponent(tradeId)}/items/${encodeURIComponent(itemId)}/cancel`,
      { opts },
    );
  }

  /** Cancel every still-cancellable item in a trade. Per-item outcomes come back in `items`. */
  cancel(tradeId: TradeRef, opts?: RequestOptions): Promise<CancelTradeResponse> {
    return this.http.request<CancelTradeResponse>(
      'POST',
      `market/transactions/${encodeURIComponent(tradeId)}/cancel`,
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

  /** Bulk per-item floors: instant (auto-deliver) + standard, after fee. `limit: -1` returns the whole catalog. Merchant account only — not available via On-Behalf-Of. */
  prices(query?: MarketPricesQuery, opts?: RequestOptions): Promise<MarketPricesResponse> {
    return this.http.request<MarketPricesResponse>('GET', 'market/prices', { query, opts });
  }

  /** Live-market browse page: top-of-book blocks ordered most-liquid then priciest, after fee.
   *  Each block carries `prices` per source instead of a flat `price`; `sources` reports lane health. */
  live(query?: MarketLiveQuery, opts?: RequestOptions): Promise<MarketFeedResponse> {
    return this.http.request<MarketFeedResponse>('GET', 'market', { query, opts });
  }

  /**
   * Watch listings over the live socket: their state on every `watch()`, then price changes and
   * removals as they happen. Reconnects on its own and re-sends the watch set. 500 ids per socket
   * for a sub-user, 20,000 for the merchant itself.
   */
  watch(handlers: MarketWatchHandlers, opts?: LiveOptions): MarketWatch {
    return watchMarket(this.http, handlers, opts);
  }

  /** Every listing that leaves the market, batched every 250 ms. Merchant account only. */
  removals(handlers: MarketRemovalsHandlers, opts?: LiveOptions): LiveConnection {
    return marketRemovals(this.http, handlers, opts);
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
   * @param externalId Your correlation id, echoed back on the Trade. Also the idempotency key: a
   *   repeat with the same id returns the first trade. Generated when omitted, so the SDK's own
   *   retries never buy twice.
   * @param opts onBehalfOf, tradeUrl override, signal, headers.
   */
  buy(
    items: BuyItem[],
    externalId?: string,
    opts?: BuyOptions,
  ): Promise<BuyResponse> {
    const keyed = idempotentBuy(externalId, opts);
    const body: { items: BuyItem[]; externalId?: string; tradeUrl?: string } = {
      items,
      externalId: keyed.externalId,
    };
    if (opts?.tradeUrl !== undefined) body.tradeUrl = opts.tradeUrl;
    return this.http.request<BuyResponse>('POST', 'market/buy', { body, opts: keyed.opts });
  }

  /**
   * POST /market/buy/quick — server picks N cheapest listings ≤ maxPrice.
   *
   * @param body itemId, maxPrice, amount, delivery.
   * @param externalId Your correlation id and idempotency key; generated when omitted.
   * @param opts onBehalfOf, tradeUrl override.
   */
  quickBuy(
    body: Omit<QuickBuyBody, 'externalId' | 'tradeUrl'>,
    externalId?: string,
    opts?: BuyOptions,
  ): Promise<QuickBuyResponse> {
    const keyed = idempotentBuy(externalId, opts);
    const fullBody: QuickBuyBody = { ...body, externalId: keyed.externalId };
    if (opts?.tradeUrl !== undefined) fullBody.tradeUrl = opts.tradeUrl;
    return this.http.request<QuickBuyResponse>('POST', 'market/buy/quick', {
      body: fullBody,
      opts: keyed.opts,
    });
  }
}
