import type { HttpClient, RequestOptions } from '../internal/http.js';
import type {
  WalletBalance, TransactionHistory, ListUserTransactionsQuery,
} from '../types/api.js';

/** Actor-context wallet (sub-user spot wallet, or merchant's own when called without onBehalfOf). */
export class WalletModule {
  constructor(private readonly http: HttpClient) {}

  balance(opts?: RequestOptions): Promise<WalletBalance> {
    return this.http.request<WalletBalance>('GET', 'user/wallet/balance', { opts });
  }

  /** Cursor-paginated ledger postings against the actor's spot wallet. */
  transactions(query?: ListUserTransactionsQuery, opts?: RequestOptions): Promise<TransactionHistory> {
    return this.http.request<TransactionHistory>('GET', 'user/wallet/ledger', { query, opts });
  }
}
