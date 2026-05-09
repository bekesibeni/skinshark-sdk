declare const __brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [__brand]: B };

export type ListingId = Brand<string, 'ListingId'>;
export type TradeId = Brand<string, 'TradeId'>;
export type ItemId = Brand<string, 'ItemId'>;
export type FundingId = Brand<string, 'FundingId'>;
export type DepositId = Brand<string, 'DepositId'>;
export type TradeUrlId = Brand<string, 'TradeUrlId'>;
export type WalletId = Brand<string, 'WalletId'>;
export type TransactionId = Brand<string, 'TransactionId'>;
export type SubUserUuid = Brand<string, 'SubUserUuid'>;
export type MerchantId = Brand<string, 'MerchantId'>;

// Endpoints that accept a sub-user UUID OR the merchant's externalId.
// Plain string at the type level since both forms are valid input.
export type SubUserRef = string;

// Same idea: trade lookup by UUID or trade externalId.
export type TradeRef = string;
