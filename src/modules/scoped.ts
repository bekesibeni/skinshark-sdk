import type { HttpClient, RequestOptions } from '../internal/http.js';
import type { Currency, SubUserResponse, UserStatus } from '../types/api.js';
import type { SubUserUuid } from '../types/branded.js';
import { ProfileModule } from './profile.js';
import { TradeUrlsModule } from './tradeUrls.js';
import { WalletModule } from './wallet.js';
import { DepositsModule } from './deposits.js';
import { MarketModule } from './market.js';

/**
 * Scoped client returned by `await sdk.as(id)`.
 *
 * Bound to a single sub-user. All sub-module calls auto-attach `On-Behalf-Of`
 * via a default-injecting HttpClient proxy. Resolved at bind time via
 * `GET /merchant/users/{id}`, which validates ownership and gives us the
 * canonical UUID, externalId, and current snapshot. Throws SkinsharkError
 * (USER_NOT_FOUND / USER_NOT_OWNED) if the ref is bogus.
 *
 * Exposes only the actor-context surface — merchant-only modules (account,
 * users, trades aggregate) are absent because the API rejects On-Behalf-Of
 * on /merchant/* routes.
 */
export class ScopedClient {
  readonly id: SubUserUuid;
  readonly createdAt: string;

  // Mutable snapshot fields — updated by `refresh()`.
  externalId: string | null;
  email: string | null;
  steamId: string | null;
  currency: Currency | null;
  balance: number;
  status: UserStatus;
  feeBps: number | null;

  readonly profile: ProfileModule;
  readonly tradeUrls: TradeUrlsModule;
  readonly wallet: WalletModule;
  readonly deposits: DepositsModule;
  readonly market: MarketModule;

  constructor(
    private readonly http: HttpClient,
    snapshot: SubUserResponse,
  ) {
    this.id = snapshot.id;
    this.createdAt = snapshot.createdAt;
    this.externalId = snapshot.externalId;
    this.email = snapshot.email;
    this.steamId = snapshot.steamId;
    this.status = snapshot.status;
    this.feeBps = snapshot.feeBps;

    this.currency = snapshot.wallet?.currency ?? null;
    this.balance = snapshot.wallet?.balance ?? 0;

    // Bind onBehalfOf to the canonical UUID once. Module classes are reused
    // unchanged — the proxy injects defaults at the request layer.
    const bound = http.withDefaults({ onBehalfOf: this.id });
    this.profile = new ProfileModule(bound);
    this.tradeUrls = new TradeUrlsModule(bound);
    this.wallet = new WalletModule(bound);
    this.deposits = new DepositsModule(bound);
    this.market = new MarketModule(bound);
  }

  /** Re-fetch the underlying SubUserResponse and update mutable fields. */
  async refresh(opts?: RequestOptions): Promise<void> {
    const fresh = await this.http.request<SubUserResponse>(
      'GET', `merchant/users/${encodeURIComponent(this.id)}`, { opts },
    );
    this.externalId = fresh.externalId;
    this.email = fresh.email;
    this.steamId = fresh.steamId;
    this.status = fresh.status;
    this.feeBps = fresh.feeBps;
    this.currency = fresh.wallet?.currency ?? null;
    this.balance = fresh.wallet?.balance ?? 0;
  }
}

/** Resolve a sub-user via /merchant/users/{id} and build a ScopedClient. */
export async function buildScoped(http: HttpClient, ref: string): Promise<ScopedClient> {
  const snapshot = await http.request<SubUserResponse>(
    'GET', `merchant/users/${encodeURIComponent(ref)}`,
  );
  return new ScopedClient(http, snapshot);
}
