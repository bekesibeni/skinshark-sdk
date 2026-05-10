import type {
  ListingId, TradeId, ItemId, FundingId, DepositId, TradeUrlId,
  WalletId, TransactionId, SubUserUuid, MerchantId, SubUserRef, TradeRef,
} from './branded.js';

// ── Envelope ─────────────────────────────────────────────────────────
export interface Envelope<T> {
  requestId: string;
  success: boolean;
  data?: T;
  error?: { code: number; key: string; message: string; [k: string]: unknown };
}

// ── Enums (mirror prisma/schema.prisma) ──────────────────────────────
export type Currency = 'USD' | 'EUR';
export type UserStatus = 'active' | 'suspended' | 'deleted';
export type Role = 'user' | 'merchant' | 'admin';
export type TwoFactorMethod = 'email' | 'totp';
export type WalletType = 'spot' | 'earnings';
export type WalletStatus = 'active' | 'suspended' | 'closed';
export type TradeStatus = 'initiated' | 'pending' | 'active' | 'hold' | 'completed' | 'failed' | 'reverted';
export type DepositStatus = 'initiated' | 'pending' | 'completed' | 'partial' | 'expired' | 'cancelled' | 'refunded' | 'failed';
export type DepositMethod = 'gatepay' | 'onramp' | 'crypto';
export type DepositCurrency = 'USDT' | 'USDC' | 'DAI' | 'BTC' | 'ETH' | 'SOL';
export type OnrampPayCurrency = 'USD' | 'EUR' | 'GBP';
export type CryptoEvmChain = 'ethereum' | 'base' | 'arbitrum' | 'optimism' | 'bsc';
export type CryptoNativeToken = 'USDT' | 'USDC' | 'NATIVE';
export type DopplerPhase = 'Phase 1' | 'Phase 2' | 'Phase 3' | 'Phase 4' | 'Ruby' | 'Sapphire' | 'Black Pearl' | 'Emerald';
export type ItemCategory = 'Normal' | 'StatTrak' | 'Souvenir';
export type SearchSort = 'relevance' | 'nameAsc' | 'nameDesc' | 'priceAsc' | 'priceDesc';
export type DeliveryMode = 'standard' | 'instant';

// ── Merchant profile / fees / stats ──────────────────────────────────
export interface MerchantProfile {
  id: MerchantId;
  email: string;
  emailVerified: boolean;
  country: string | null;
  roles: string[];
  twoFactorEnabled: boolean;
  twoFactorMethod: string | null;
  feeBps: number;
  merchantFeeBps: number;
  childDefaultFeeBps: number | null;
  wallets: {
    spot: { currency: string; balance: number } | null;
    earnings: { currency: string; balance: number } | null;
  };
  createdAt: string;
}

export interface FeesResponse {
  merchantFeeBps: number;
  childDefaultFeeBps: number | null;
  globalDefaultFeeBps: number;
  effectiveChildFeeBps: number;
}

export interface StatsResponse {
  totals: {
    tradeCount: number;
    gmv: number;
    gmvCents: number;
    feesEarnedCents: number;
    feesEarned: number;
    spotBalance: number;
    earningsBalance: number;
    currency: string | null;
  };
  bySubUser: Array<{
    subUserId: string;
    email: string | null;
    externalId: string | null;
    tradeCount: number;
    gmvCents: number;
    gmv: number;
    balance: number;
    feesContributedCents: number;
  }>;
  byStatus: Record<string, number>;
}

// ── Sub-users ────────────────────────────────────────────────────────
export interface SubUserListItem {
  id: SubUserUuid;
  email: string | null;
  steamId: string | null;
  externalId: string | null;
  status: UserStatus;
  feeBps: number | null;
  currency: Currency | null;
  balance: number;
  createdAt: string;
}

export interface SubUserListResponse {
  items: SubUserListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CreateSubUserBody {
  email?: string;
  steamId?: string;
  externalId?: string;
  currency?: Currency;
}

export interface CreateSubUserResponse {
  id: SubUserUuid;
  email: string | null;
  steamId: string | null;
  externalId: string | null;
  status: UserStatus;
  feeBps: number | null;
  createdAt: string;
  currency: Currency;
  /** True when the response replays a prior create with the same externalId. */
  idempotent: boolean;
}

export interface SubUserResponse {
  id: SubUserUuid;
  email: string | null;
  steamId: string | null;
  externalId: string | null;
  status: UserStatus;
  feeBps: number | null;
  createdAt: string;
  wallet: {
    type: WalletType;
    status: WalletStatus;
    currency: Currency | null;
    balance: number;
  } | null;
}

export interface FundBody {
  /** Decimal in the merchant's currency, e.g. "5.50". */
  amount: string;
}

export interface FundResponse {
  transactionId: TransactionId;
  idempotent: boolean;
}

// ── Wallet ───────────────────────────────────────────────────────────
export interface WalletBalance {
  currency: Currency;
  balance: number;
}

export interface MerchantWallet {
  walletId: WalletId;
  type: WalletType;
  currency: Currency;
  balance: number;
}

export interface TransactionItem {
  id: string;
  type: string;
  description: string;
  status: 'posted' | 'reversed';
  amount: number;
  occurredAt: string;
  externalRef: string | null;
}

export interface TransactionHistory {
  items: TransactionItem[];
  nextCursor: string | null;
}

// ── Deposits — Gate Pay ──────────────────────────────────────────────
export interface DepositChainsResponse {
  currencies: Array<{
    currency: DepositCurrency;
    chains: string[];
    isStable: boolean;
    minDepositUsd: number;
  }>;
}

export interface DepositQuoteBody {
  currency: DepositCurrency;
  /** Decimal USD amount, e.g. "100.00". */
  amount: string;
}

export interface DepositQuoteResponse {
  token: DepositCurrency;
  currency: Currency;
  payAmountToken: number;
  receiveAmountUsd: number;
  receiveAmount: number;
  fee: number;
  exchangeRate: number;
  quoteToken: string;
  expiresIn: string;
}

export interface CreateDepositBody {
  quoteToken: string;
  chain: string;
}

export interface CreateDepositResponse {
  fundingId: FundingId;
  status: DepositStatus;
  currency: Currency;
  payAmountToken: number;
  receiveAmountUsd: number;
  receiveAmount: number;
  exchangeRate: number;
  fee: number;
  expireTime: number | null;
  whitelabelUrl: string | null;
  onChain: {
    network: string;
    token: DepositCurrency;
    address: string;
  };
}

// ── Deposits — On-ramp ───────────────────────────────────────────────
export interface OnrampQuoteBody {
  payAmount?: number;
  receiveAmount?: number;
  payCurrency: OnrampPayCurrency;
}

export interface OnrampQuoteResponse {
  currency: Currency;
  payAmount: number;
  receiveAmount: number;
  receiveAmountUsd: number;
  payCurrency: OnrampPayCurrency;
  exchangeRate: number;
  fees: { onrampFee: number; clientFee: number; gatewayFee: number; gasFee: number };
}

export interface OnrampSessionBody extends OnrampQuoteBody {
  redirectUrl?: string;
}

export interface OnrampSessionResponse {
  fundingId: FundingId;
  status: 'initiated' | 'completed' | 'failed';
  currency: Currency;
  payAmount: number;
  receiveAmount: number;
  receiveAmountUsd: number;
  payCurrency: OnrampPayCurrency;
  exchangeRate: number;
  whitelabelUrl: string;
}

// ── Deposits — Self-hosted EVM crypto ────────────────────────────────
export interface CryptoAddressResponse {
  address: string;
  chains: CryptoEvmChain[];
  tokens: CryptoNativeToken[];
}

export interface CryptoQuoteBody {
  token: 'USDT' | 'USDC';
  amount: number;
}

export interface CryptoQuoteChainPreview {
  feeCents: number;
  receiveAmountUsd: number;
  receiveAmount: number;
  gasGwei: number;
}

export interface CryptoQuoteResponse {
  token: string;
  amount: number;
  walletCurrency: Currency;
  exchangeRate: number;
  feeBps: number;
  chains: Record<string, CryptoQuoteChainPreview>;
}

// ── Deposit cancel/resume ────────────────────────────────────────────
export interface CancelDepositResponse {
  depositId: DepositId;
  status: DepositStatus;
}

export interface ResumeDepositResponse {
  fundingId: FundingId;
  status: DepositStatus;
  method: DepositMethod;
  currency: Currency;
  amount: number;
  whitelabelUrl: string | null;
  onChain: { network: string; token: string; address: string } | null;
}

// ── Sub-user profile + Steam trade URLs ──────────────────────────────
export interface UserProfile {
  id: SubUserUuid;
  email: string;
  emailVerified: boolean;
  country: string | null;
  roles: Role[];
  twoFactorEnabled: boolean;
  twoFactorMethod: TwoFactorMethod | null;
  steam: {
    steamId: string;
    personaName: string | null;
    avatarUrl: string | null;
    profileUrl: string | null;
    tradeUrl: string;
  } | null;
  discord: {
    discordId: string;
    username: string;
    avatar: string | null;
  } | null;
  wallet: {
    currency: Currency;
    balance: number;
  } | null;
  createdAt: string;
}

export interface AddTradeUrlBody {
  url: string;
}

export interface UpdateTradeUrlBody {
  url?: string;
  isPrimary?: boolean;
}

export interface TradeUrlResponse {
  id: TradeUrlId;
  url: string;
  steamId: string;
  personaName: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export type TradeUrlListResponse = TradeUrlResponse[];

// ── Catalog ──────────────────────────────────────────────────────────
export interface SuggestionItem {
  id: ItemId;
  marketHashName: string;
  iconUrl: string;
  rarity?: string;
  rarityColor?: string;
  itemType?: string;
}

export type SuggestionsResponse = SuggestionItem[];

export interface SearchResultItem {
  id: ItemId;
  name: string;
  marketHashName: string;
  itemType?: string;
  iconUrl?: string;
  weapon?: string;
  wear?: string;
  rarity?: string;
  rarityColor?: string;
  category?: ItemCategory;
  collection?: string;
  floatRange?: [number, number];
  price?: number;
  listingsCount?: number;
  steamPrice?: number;
}

export interface SearchResponse {
  items: SearchResultItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ItemDetail {
  id: ItemId;
  name: string;
  marketHashName: string;
  itemType: string | null;
  iconUrl: string | null;
  weapon?: string;
  wear?: string;
  rarity?: string;
  rarityColor?: string;
  category?: string;
  collection?: string;
  floatRange?: [number, number];
  floatBuckets?: Array<{ min: number; max: number }>;
  paintIndex?: number;
  description: string | null;
  tags?: string[];
  containedItems?: string[];
  phases?: Array<{ name: string; iconUrl: string | null }>;
  price: number | null;
  listingsCount: number | null;
  steamPrice: number | null;
}

export interface ItemDetailResponse {
  item: ItemDetail;
  offersOverview?: Record<string, { price: number | null; listingsCount: number | null }>;
}

// ── Listings ─────────────────────────────────────────────────────────
export interface MarketListing {
  id: ListingId;
  marketHashName: string;
  name: string;
  type: string;
  iconUrl: string;
  price: number;
  referencePrice?: number;
  exterior?: string;
  rarity?: string;
  collection?: string;
  color?: string;
  wear?: number | null;
  paintSeed?: number | null;
  doppler?: { status: number; name: string; paintIndex?: number };
  fade?: { percentage: number };
  hardened?: { status: number; name: string };
  stickers?: Array<{
    name: string;
    marketHashName?: string;
    slot: number;
    wear?: number;
    iconUrl: string;
  }>;
  charm?: { name: string; marketHashName?: string; pattern?: string; iconUrl: string };
  inspectUrl?: string;
  delivery?: string;
}

export interface ListingsResponse {
  items: MarketListing[];
  total: number;
}


// ── Trades ───────────────────────────────────────────────────────────
export interface BuyItem {
  listingId: ListingId | string;
  /** Decimal max acceptable unit price, e.g. "5.50". */
  maxPrice: string;
}

export interface BuyBody {
  items: BuyItem[];
  tradeUrl?: string;
  externalId?: string;
}

export interface BuyResponse {
  id: TradeId;
  status: TradeStatus;
  itemCount: number;
  totalPrice: number;
  createdAt: string;
}

export interface QuickBuyBody {
  itemId: ItemId | string;
  /** Decimal max acceptable unit price, e.g. "5.50". */
  maxPrice: string;
  amount: number;
  delivery: DeliveryMode;
  tradeUrl?: string;
  externalId?: string;
}

export interface QuickBuyResponse {
  id: TradeId;
  status: TradeStatus;
  requestedCount: number;
  itemCount: number;
  totalPrice: number;
  createdAt: string;
}

export interface TradeItem {
  /** Listing id — the same id returned by listing endpoints. Use this id when calling the cancel endpoint. */
  id: ListingId;
  name: string | null;
  marketHashName: string | null;
  type: string | null;
  iconUrl: string | null;
  price: number;
  exterior?: string;
  rarity?: string;
  color?: string;
  phase?: string;
  wear?: string;
  paintSeed?: number;
  stickers?: Array<{ name: string; slot: number; wear?: number; iconUrl: string }>;
  charm?: { name: string; pattern?: string; iconUrl: string };
  delivery?: string;
  status?: string;
  tradable?: boolean;
  error?: string;
}

export interface Trade {
  id: TradeId;
  type: string;
  userId: string;
  steamId: string;
  tradeUrl: string;
  offerId?: string;
  externalId?: string;
  status: TradeStatus;
  game: string;
  items: TradeItem[];
  summary: { total: number; completed: number; failed: number };
  totalPrice: number;
  currency: Currency;
  holdEndDate?: string;
  settledAt?: string;
  revertedBy?: 'supplier' | 'user';
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionListResponse {
  items: Trade[];
  nextCursor: string | null;
}

export interface MerchantTradeListResponse {
  items: Trade[];
  nextCursor: string | null;
}

export interface CancelItemResponse {
  itemId: ListingId;
  status: 'cancelled' | 'failed';
}

// ── Filter shapes used by list/search endpoints ──────────────────────
export interface ListSubUsersQuery {
  page?: number;
  limit?: number;
  status?: UserStatus;
  search?: string;
  externalId?: string;
}

export interface ListLedgerQuery {
  type?: WalletType;
  cursor?: string;
  limit?: number;
}

export interface ListUserLedgerQuery {
  cursor?: string;
  limit?: number;
}

export interface ListUserTransactionsQuery {
  type?: string;
  cursor?: string;
  limit?: number;
}

export interface ListMerchantTradesQuery {
  status?: TradeStatus;
  subUserId?: SubUserRef;
  itemName?: string;
  externalId?: string;
  offerId?: string;
  tradeId?: TradeRef;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface ListSubUserTradesQuery {
  status?: TradeStatus;
  itemName?: string;
  externalId?: string;
  offerId?: string;
  tradeId?: TradeRef;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface SearchQuery {
  q?: string;
  weapon?: string;
  rarity?: string;
  wear?: string;
  category?: ItemCategory;
  itemType?: string;
  tags?: string;
  paintIndex?: number;
  collection?: string;
  priceMin?: number;
  priceMax?: number;
  sort?: SearchSort;
  page?: number;
  limit?: number;
}

export interface ListListingsQuery {
  page?: number;
  limit?: number;
  market?: number;
  phase?: DopplerPhase;
  wearMin?: number;
  wearMax?: number;
}

export interface ListMarketTradesQuery {
  cursor?: string;
  limit?: number;
  status?: TradeStatus;
}

export interface StatsQuery {
  from?: string;
  to?: string;
}
