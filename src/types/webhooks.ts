import type { Trade } from './api.js';

export type TradeEventType =
  | 'trade.initiated'
  | 'trade.pending'
  | 'trade.active'
  | 'trade.hold'
  | 'trade.completed'
  | 'trade.failed'
  | 'trade.canceled'
  | 'trade.declined'
  | 'trade.reverted'
  | 'trade.settled'
  | 'trade.refunded';

export type DepositEventType =
  | 'deposit.initiated'
  | 'deposit.pending'
  | 'deposit.completed'
  | 'deposit.partial'
  | 'deposit.expired'
  | 'deposit.failed'
  | 'deposit.refunded'
  | 'deposit.cancelled';

// `approval` is the synchronous, signed pre-broadcast call — respond 2xx to release funds, 4xx to
// reject. The rest are async lifecycle notifications; `refunded` is the single terminal failure event.
export type PayoutCryptoEventType =
  | 'payout.crypto.deposit.completed'
  | 'payout.crypto.withdraw.approval'
  | 'payout.crypto.withdraw.broadcast'
  | 'payout.crypto.withdraw.confirmed'
  | 'payout.crypto.withdraw.refunded';

export type WebhookEventType = TradeEventType | DepositEventType | PayoutCryptoEventType;

export interface SerializedWebhookDeposit {
  id: string;
  userId: string;
  method: string;
  status: string;
  currency: string;
  amountCents: number;
  feeCents: number;
  token: string | null;
  chain: string | null;
  cryptoAmount: string | null;
  externalId: string | null;
  completedAt: string | null;
  createdAt: string;
  txHash: string | null;
  amountWei: string | null;
  amountUsdCents: number | null;
  confirmations: number;
  sweptAt: string | null;
}

export interface SerializedPayoutWithdrawal {
  id: string;
  userId: string;
  externalId: string | null;
  forUserId: string | null;
  forUserExternalId: string | null;
  status: string;
  chain: string | null;
  token: string | null;
  tokenAddress: string | null;
  destination: string | null;
  amountCents: number;
  feeCents: number;
  amountWei: string | null;
  txHash: string | null;
  failureReason: string | null;
  callbackAttempts: number;
  createdAt: string;
  broadcastAt: string | null;
  confirmedAt: string | null;
}

export interface TradeEventData {
  trade: Trade;
  settlement?: { houseFeeCents: number; merchantFeeCents: number };
}

export interface DepositEventData {
  deposit: SerializedWebhookDeposit;
}

export interface PayoutCryptoDepositEventData {
  deposit: SerializedWebhookDeposit;
  forUserExternalId: string | null;
}

export interface PayoutCryptoWithdrawalEventData {
  withdrawal: SerializedPayoutWithdrawal;
}

interface BaseEnvelope<TType extends WebhookEventType, TData> {
  id: string;
  type: TType;
  createdAt: string;
  data: TData;
}

export type TradeEvent = BaseEnvelope<TradeEventType, TradeEventData>;
export type DepositEvent = BaseEnvelope<DepositEventType, DepositEventData>;
export type PayoutCryptoDepositEvent = BaseEnvelope<
  'payout.crypto.deposit.completed',
  PayoutCryptoDepositEventData
>;
export type PayoutCryptoWithdrawalEvent = BaseEnvelope<
  Exclude<PayoutCryptoEventType, 'payout.crypto.deposit.completed'>,
  PayoutCryptoWithdrawalEventData
>;
export type PayoutCryptoEvent = PayoutCryptoDepositEvent | PayoutCryptoWithdrawalEvent;

/** Discriminated union of every webhook event delivered to your URL. */
export type WebhookEvent = TradeEvent | DepositEvent | PayoutCryptoEvent;
