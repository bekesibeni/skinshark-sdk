import type { HttpClient, RequestOptions } from '../internal/http.js';
import { newIdempotencyKey } from '../internal/idempotency.js';
import type {
  SubUserListResponse, CreateSubUserBody, CreateSubUserResponse, SubUserResponse,
  FundBody, FundResponse, MerchantWallet, TransactionHistory, MerchantTradeListResponse,
  ListSubUsersQuery, ListUserLedgerQuery, ListSubUserTradesQuery,
} from '../types/api.js';
import type { SubUserRef } from '../types/branded.js';

export class UsersModule {
  constructor(private readonly http: HttpClient) {}

  list(query?: ListSubUsersQuery, opts?: RequestOptions): Promise<SubUserListResponse> {
    return this.http.request<SubUserListResponse>('GET', 'merchant/users', { query, opts });
  }

  /** At least one of email or steamId is required. */
  create(body: CreateSubUserBody, opts?: RequestOptions): Promise<CreateSubUserResponse> {
    return this.http.request<CreateSubUserResponse>('POST', 'merchant/users', { body, opts });
  }

  /** `id` accepts UUID or your externalId. */
  get(id: SubUserRef, opts?: RequestOptions): Promise<SubUserResponse> {
    return this.http.request<SubUserResponse>('GET', `merchant/users/${encodeURIComponent(id)}`, { opts });
  }

  /** Soft-delete; wallet is closed. Cannot be undone via API. */
  delete(id: SubUserRef, opts?: RequestOptions): Promise<null> {
    return this.http.request<null>('DELETE', `merchant/users/${encodeURIComponent(id)}`, { opts });
  }

  /** Login + buy blocked while suspended. */
  suspend(id: SubUserRef, opts?: RequestOptions): Promise<null> {
    return this.http.request<null>('POST', `merchant/users/${encodeURIComponent(id)}/suspend`, { opts });
  }

  reactivate(id: SubUserRef, opts?: RequestOptions): Promise<null> {
    return this.http.request<null>('POST', `merchant/users/${encodeURIComponent(id)}/reactivate`, { opts });
  }

  /**
   * Move funds from merchant spot wallet to sub-user wallet.
   * If `opts.idempotencyKey` is omitted, a fresh UUID is generated. Replays
   * with the same key return `idempotent: true` and the original transactionId.
   */
  fund(
    id: SubUserRef,
    body: FundBody,
    opts?: RequestOptions,
  ): Promise<FundResponse> {
    const finalOpts: RequestOptions = {
      ...(opts ?? {}),
      idempotencyKey: opts?.idempotencyKey ?? newIdempotencyKey(),
    };
    return this.http.request<FundResponse>(
      'POST',
      `merchant/users/${encodeURIComponent(id)}/fund`,
      { body, opts: finalOpts },
    );
  }

  wallet(id: SubUserRef, opts?: RequestOptions): Promise<MerchantWallet> {
    return this.http.request<MerchantWallet>('GET', `merchant/users/${encodeURIComponent(id)}/wallet`, { opts });
  }

  ledger(id: SubUserRef, query?: ListUserLedgerQuery, opts?: RequestOptions): Promise<TransactionHistory> {
    return this.http.request<TransactionHistory>('GET', `merchant/users/${encodeURIComponent(id)}/ledger`, { query, opts });
  }

  trades(id: SubUserRef, query?: ListSubUserTradesQuery, opts?: RequestOptions): Promise<MerchantTradeListResponse> {
    return this.http.request<MerchantTradeListResponse>('GET', `merchant/users/${encodeURIComponent(id)}/trades`, { query, opts });
  }
}
