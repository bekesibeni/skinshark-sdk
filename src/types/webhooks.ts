import type { Trade } from './api.js';

export type TradeEventType =
  | 'trade.initiated'
  | 'trade.pending'
  | 'trade.active'
  | 'trade.hold'
  | 'trade.completed'
  | 'trade.failed'
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

export type WebhookEventType = TradeEventType | DepositEventType;

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

export interface TradeEventData {
  trade: Trade;
  settlement?: { houseFeeCents: number; merchantFeeCents: number };
}

export interface DepositEventData {
  deposit: SerializedWebhookDeposit;
}

interface BaseEnvelope<TType extends WebhookEventType, TData> {
  id: string;
  type: TType;
  createdAt: string;
  data: TData;
}

export type TradeEvent = BaseEnvelope<TradeEventType, TradeEventData>;
export type DepositEvent = BaseEnvelope<DepositEventType, DepositEventData>;

/** Discriminated union of every webhook event delivered to your URL. */
export type WebhookEvent = TradeEvent | DepositEvent;
