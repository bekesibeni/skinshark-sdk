import { HttpClient, type SkinsharkClientOptions, type RequestOptions } from './internal/http.js';
import { newIdempotencyKey as generateKey } from './internal/idempotency.js';
import { AccountModule } from './modules/account.js';
import { UsersModule } from './modules/users.js';
import { TradesModule } from './modules/trades.js';
import { ProfileModule } from './modules/profile.js';
import { TradeUrlsModule } from './modules/tradeUrls.js';
import { WalletModule } from './modules/wallet.js';
import { DepositsModule } from './modules/deposits.js';
import { MarketModule } from './modules/market.js';
import { buildScoped, type ScopedClient } from './modules/scoped.js';
import type { Envelope } from './types/api.js';

export class Skinshark {
  // Merchant-only
  readonly account: AccountModule;
  readonly users: UsersModule;
  readonly trades: TradesModule;

  // Actor-context (run as merchant by default; flip with opts.onBehalfOf)
  readonly profile: ProfileModule;
  readonly tradeUrls: TradeUrlsModule;
  readonly wallet: WalletModule;
  readonly deposits: DepositsModule;
  readonly market: MarketModule;

  private readonly http: HttpClient;

  constructor(opts: SkinsharkClientOptions) {
    this.http = new HttpClient(opts);
    this.account = new AccountModule(this.http);
    this.users = new UsersModule(this.http);
    this.trades = new TradesModule(this.http);
    this.profile = new ProfileModule(this.http);
    this.tradeUrls = new TradeUrlsModule(this.http);
    this.wallet = new WalletModule(this.http);
    this.deposits = new DepositsModule(this.http);
    this.market = new MarketModule(this.http);
  }

  /**
   * Resolve a sub-user (UUID or externalId) and return a scoped client.
   * Validates ownership via GET /merchant/users/{id}.
   * Throws SkinsharkError (USER_NOT_FOUND / USER_NOT_OWNED) if the ref is bogus
   * or belongs to a different merchant.
   */
  as(ref: string): Promise<ScopedClient> {
    return buildScoped(this.http, ref);
  }

  /**
   * Quick connectivity + auth check. Hits GET /merchant.
   * Throws on bad key, suspended account, IP not allowlisted.
   */
  async health(): Promise<{ ok: true }> {
    await this.account.get();
    return { ok: true };
  }

  /** Generate a fresh UUIDv4 (e.g. for pre-allocated Idempotency-Keys). */
  newIdempotencyKey(): string {
    return generateKey();
  }

  /**
   * Escape hatch for endpoints not yet wrapped, or future API additions.
   * Goes through the same auth + retry + envelope-unwrap pipeline.
   */
  request<T>(init: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string;
    query?: Record<string, string | number | boolean | undefined>;
    body?: unknown;
    opts?: RequestOptions;
  }): Promise<T> {
    return this.http.request<T>(init.method, init.path, {
      query: init.query,
      body: init.body,
      opts: init.opts,
    });
  }
}

export type { SkinsharkClientOptions, RequestOptions, Envelope };
