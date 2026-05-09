import type { Currency, TradeStatus } from './api.js';

export type TradeEventType =
  | 'trade.initiated'
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

export interface SerializedWebhookTrade {
  id: string;
  type: string;
  status: TradeStatus | string;
  userId: string;
  externalId: string | null;
  steamId: string;
  tradeId: string | null;
  offerId: string | null;
  game: string;
  currency: Currency;
  fxRateLockedBp: number | null;
  totalPriceCents: number;
  totalUsdCents: number;
  pendingCreditCents: number | null;
  houseFeeCents: number | null;
  merchantFeeCents: number | null;
  merchantId: string | null;
  holdEndDate: string | null;
  revertedBy: string | null;
  settledAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedWebhookItem {
  id: string;
  rawId: string | null;
  name: string | null;
  marketHashName: string | null;
  appid: number;
  purchaseStatus: string | null;
  purchaseError: string | null;
}

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
  trade: SerializedWebhookTrade;
  item?: SerializedWebhookItem;
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
