import type { HttpClient, RequestOptions } from '../internal/http.js';
import type {
  DepositChainsResponse, DepositQuoteBody, DepositQuoteResponse,
  CreateDepositBody, CreateDepositResponse,
  OnrampQuoteBody, OnrampQuoteResponse, OnrampSessionBody, OnrampSessionResponse,
  CryptoAddressResponse, CryptoQuoteBody, CryptoQuoteResponse,
  CancelDepositResponse, ResumeDepositResponse,
} from '../types/api.js';
import type { DepositId } from '../types/branded.js';

class GateDepositsModule {
  constructor(private readonly http: HttpClient) {}

  chains(opts?: RequestOptions): Promise<DepositChainsResponse> {
    return this.http.request<DepositChainsResponse>('GET', 'user/wallet/deposit/gate/chains', { opts });
  }

  /** Quote is short-lived (TTL embedded in `expiresIn`). Pass `quoteToken` to `create`. */
  quote(body: DepositQuoteBody, opts?: RequestOptions): Promise<DepositQuoteResponse> {
    return this.http.request<DepositQuoteResponse>('POST', 'user/wallet/deposit/gate/quote', { body, opts });
  }

  /** Commit a quote; returns hosted URL and/or on-chain pay-to address. */
  create(body: CreateDepositBody, opts?: RequestOptions): Promise<CreateDepositResponse> {
    return this.http.request<CreateDepositResponse>('POST', 'user/wallet/deposit/gate', { body, opts });
  }
}

class OnrampDepositsModule {
  constructor(private readonly http: HttpClient) {}

  quote(body: OnrampQuoteBody, opts?: RequestOptions): Promise<OnrampQuoteResponse> {
    return this.http.request<OnrampQuoteResponse>('POST', 'user/wallet/deposit/onramp/quote', { body, opts });
  }

  /** Returns `whitelabelUrl` for the user to complete card payment. */
  session(body: OnrampSessionBody, opts?: RequestOptions): Promise<OnrampSessionResponse> {
    return this.http.request<OnrampSessionResponse>('POST', 'user/wallet/deposit/onramp/session', { body, opts });
  }
}

class CryptoDepositsModule {
  constructor(private readonly http: HttpClient) {}

  /** Same EVM address across all supported chains; idempotent. */
  address(opts?: RequestOptions): Promise<CryptoAddressResponse> {
    return this.http.request<CryptoAddressResponse>('GET', 'user/wallet/deposit/crypto/address', { opts });
  }

  /** Per-chain receive + gas preview for the requested token + amount. */
  quote(body: CryptoQuoteBody, opts?: RequestOptions): Promise<CryptoQuoteResponse> {
    return this.http.request<CryptoQuoteResponse>('POST', 'user/wallet/deposit/crypto/quote', { body, opts });
  }
}

export class DepositsModule {
  readonly gate: GateDepositsModule;
  readonly onramp: OnrampDepositsModule;
  readonly crypto: CryptoDepositsModule;

  constructor(private readonly http: HttpClient) {
    this.gate = new GateDepositsModule(http);
    this.onramp = new OnrampDepositsModule(http);
    this.crypto = new CryptoDepositsModule(http);
  }

  /** No-op once the deposit is in a final state (completed/failed/refunded/cancelled/expired). */
  cancel(depositId: DepositId | string, opts?: RequestOptions): Promise<CancelDepositResponse> {
    return this.http.request<CancelDepositResponse>(
      'POST', `user/wallet/deposit/${encodeURIComponent(depositId)}/cancel`, { opts },
    );
  }

  /** Returns the current `whitelabelUrl` / on-chain address for an in-progress deposit. */
  resume(depositId: DepositId | string, opts?: RequestOptions): Promise<ResumeDepositResponse> {
    return this.http.request<ResumeDepositResponse>(
      'POST', `user/wallet/deposit/${encodeURIComponent(depositId)}/resume`, { opts },
    );
  }
}
