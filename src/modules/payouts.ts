import type { HttpClient, RequestOptions } from '../internal/http.js';
import type {
  PayoutAddressResponse, PayoutBalancesResponse,
  PayoutQuoteBody, PayoutQuoteResponse,
  PayoutWithdrawBody, PayoutWithdrawResponse,
  PayoutWithdrawalDetail, PayoutWithdrawalListQuery, PayoutWithdrawalListResponse,
} from '../types/api.js';
import type { WithdrawalId } from '../types/branded.js';

/**
 * Partner crypto-payout custody. Merchant-context: funds always come from the merchant's custody
 * balance — sub-user attribution is the `forSubUser` body field, not the On-Behalf-Of header.
 */
export class PayoutsModule {
  constructor(private readonly http: HttpClient) {}

  /** Shared EVM forwarder address for funding payout custody; idempotent. */
  address(opts?: RequestOptions): Promise<PayoutAddressResponse> {
    return this.http.request<PayoutAddressResponse>('GET', 'user/wallet/payout/crypto/address', { opts });
  }

  /** Per-(chain, token) custody balances, in USD cents. */
  balances(opts?: RequestOptions): Promise<PayoutBalancesResponse> {
    return this.http.request<PayoutBalancesResponse>('GET', 'user/wallet/payout/crypto/balances', { opts });
  }

  /** Advisory live network-fee quote + 24h gas stats; not a commitment. */
  quote(body: PayoutQuoteBody, opts?: RequestOptions): Promise<PayoutQuoteResponse> {
    return this.http.request<PayoutQuoteResponse>('POST', 'user/wallet/payout/crypto/withdraw/quote', { body, opts });
  }

  /** Request a payout. `externalId` is the idempotency key — replaying it returns the original. */
  withdraw(body: PayoutWithdrawBody, opts?: RequestOptions): Promise<PayoutWithdrawResponse> {
    return this.http.request<PayoutWithdrawResponse>('POST', 'user/wallet/payout/crypto/withdraw', { body, opts });
  }

  getWithdrawal(id: WithdrawalId | string, opts?: RequestOptions): Promise<PayoutWithdrawalDetail> {
    return this.http.request<PayoutWithdrawalDetail>(
      'GET', `user/wallet/payout/crypto/withdrawals/${encodeURIComponent(id)}`, { opts },
    );
  }

  /** Cursor-paginated payout withdrawals for the merchant. */
  listWithdrawals(
    query?: PayoutWithdrawalListQuery,
    opts?: RequestOptions,
  ): Promise<PayoutWithdrawalListResponse> {
    return this.http.request<PayoutWithdrawalListResponse>('GET', 'user/wallet/payout/crypto/withdrawals', { query, opts });
  }
}
