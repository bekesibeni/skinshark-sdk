import type { HttpClient, RequestOptions } from '../internal/http.js';
import type {
  MerchantProfile, FeesResponse, StatsResponse, MerchantWallet, TransactionHistory,
  StatsQuery, ListLedgerQuery, WalletType,
} from '../types/api.js';

export class AccountModule {
  constructor(private readonly http: HttpClient) {}

  /** Merchant identity, fees, 2FA state, balances. */
  get(opts?: RequestOptions): Promise<MerchantProfile> {
    return this.http.request<MerchantProfile>('GET', 'merchant', { opts });
  }

  /** Fee configuration (read-only over API; adjust in the dashboard). */
  fees(opts?: RequestOptions): Promise<FeesResponse> {
    return this.http.request<FeesResponse>('GET', 'merchant/fees', { opts });
  }

  /** GMV, fees earned, top 10 sub-users, status breakdown. */
  stats(query?: StatsQuery, opts?: RequestOptions): Promise<StatsResponse> {
    return this.http.request<StatsResponse>('GET', 'merchant/stats', { query, opts });
  }

  /** Merchant spot or earnings wallet. */
  wallet(query?: { type?: WalletType }, opts?: RequestOptions): Promise<MerchantWallet> {
    return this.http.request<MerchantWallet>('GET', 'merchant/wallet', { query, opts });
  }

  /** Cursor-paginated postings against merchant spot or earnings wallet. */
  ledger(query?: ListLedgerQuery, opts?: RequestOptions): Promise<TransactionHistory> {
    return this.http.request<TransactionHistory>('GET', 'merchant/ledger', { query, opts });
  }
}
