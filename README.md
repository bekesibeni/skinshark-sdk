# @skinshark/sdk

Official TypeScript SDK for the [SkinShark](https://skinshark.gg) Merchant API.

Server-to-server. ESM-only. Node 22+ (also runs on Bun via Node compat).

```bash
npm install @skinshark/sdk
```

## Quickstart

```ts
import { Skinshark } from '@skinshark/sdk';

const sdk = new Skinshark({
  apiKey: process.env.SKINSHARK_API_KEY!,
  webhookSecret: process.env.SKINSHARK_WH_SECRET!,  // optional, enables sdk.verifyWebhook(...)
});

// Merchant context — runs as your account
const profile = await sdk.account.get();
const stats = await sdk.account.stats({ from: '2026-01-01T00:00:00Z' });

// Sub-user context — bind once, then call as that user
const user = await sdk.as('your-external-id-or-uuid');
const trade = await user.market.buy(
  [{ listingId, maxPrice: '5.00' }],
  'order-7421',
);
```

## Concepts

### Two contexts

Every endpoint runs as either **the merchant** or **a sub-user**. The merchant
manages sub-users + sees aggregate state; sub-users do the actual buying.

```ts
// Merchant-only
sdk.account.get()                // GET /merchant
sdk.users.list({ status: 'active' })
sdk.users.fund('u-1', { amount: '50.00' })
sdk.trades.list({ status: 'completed' })

// Actor-context — runs as merchant by default
sdk.market.search({ q: 'AK' })          // merchant searches as itself
sdk.wallet.balance()                    // merchant's own wallet
sdk.market.buy(items, 'order-1')        // merchant buys for itself
```

### Switching to a sub-user

Two equivalent forms:

```ts
// 1) Scoped client — best for many calls per sub-user
const u = await sdk.as('user-42');
await u.market.buy(items, 'order-1');
await u.wallet.balance();
await u.deposits.gate.create({ quoteToken, chain: 'TRX' });

// 2) Per-call option — best for one-off calls
await sdk.market.buy(items, 'order-1', { onBehalfOf: 'user-42' });
```

`sdk.as(id)` validates ownership at bind time (hits `GET /merchant/users/{id}`)
and throws `SkinsharkError` with key `USER_NOT_FOUND` or `USER_NOT_OWNED` if
the ref is bogus or belongs to a different merchant. Resolved fields are cached
on the returned client:

```ts
u.id          // SubUserUuid (UUID)
u.externalId  // your external id, if you set one
u.email
u.steamId
u.currency    // 'USD' | 'EUR' | null
u.balance     // spot wallet snapshot
u.status      // 'active' | 'suspended' | 'deleted'
u.feeBps
await u.refresh();   // re-fetch and update fields
```

## API surface

```
sdk
├── account.{get,fees,stats,wallet,ledger}                      merchant-only
├── users.{list,create,get,delete,suspend,reactivate,
│         fund,wallet,ledger,trades}                            merchant-only
├── trades.{list,get}                                           merchant-only (aggregate)
├── profile.get                                                 actor-context
├── tradeUrls.{list,add,update,delete}                          actor-context
├── wallet.{balance,transactions}                               actor-context
├── deposits
│   ├── gate.{chains,quote,create}
│   ├── onramp.{quote,session}
│   ├── crypto.{address,quote}
│   └── cancel(id) / resume(id)                                 actor-context
├── market
│   ├── suggest, search, item                                   (catalog)
│   ├── listings, listing
│   ├── buy(items, externalId?, opts?)
│   ├── quickBuy(body, externalId?, opts?)
│   └── trades.{list,get,cancelItem}                            actor's own trades
├── as(ref) → ScopedClient                                      sub-user-bound view
├── health()                                                    auth/connectivity check
├── newIdempotencyKey()                                         UUIDv4 generator
├── verifyWebhook(rawBody, headers, opts?)                      uses ctor webhookSecret
└── request<T>({ method, path, query, body, opts })             escape hatch

verifyWebhook(rawBody, headers, { secret, toleranceSeconds? })  standalone (no client)
isError(e, key) / isAuthError / isRateLimited / isValidationError
meta(response) → { requestId, status, headers, rateLimit }
```

## Buying listings

```ts
// Specific listings (1–10) with per-item price ceilings
const trade = await sdk.market.buy(
  [
    { listingId: 'uuid-of-listing', maxPrice: '5.50' },
    { listingId: 'uuid-of-other',   maxPrice: '12.00' },
  ],
  'order-7421',                        // your correlation id (positional, optional)
  { onBehalfOf: 'user-42', tradeUrl: 'https://steamcommunity.com/...' },
);

// Quick-buy: server picks N cheapest matching listings
const filled = await sdk.market.quickBuy(
  { itemId: 'item-id', maxPrice: '5.00', amount: 20, delivery: 'instant' },
  'order-7422',
  { onBehalfOf: 'user-42' },
);
```

## Creating sub-users

```ts
// externalId is your stable id for this user. POSTing the same externalId
// + matching email/steamId is idempotent — the existing user is returned.
const created = await sdk.users.create({
  email: 'a@x.com',
  externalId: 'customer_42',
});

if (created.idempotent) {
  // POST replayed an existing customer_42; no new sub-user was created.
}

// Different email + same externalId → 409 EXTERNAL_ID_TAKEN.
```

## Funding sub-users

```ts
// Idempotency-Key auto-generated as UUIDv4
const tx = await sdk.users.fund('user-42', { amount: '50.00' });

// Bring your own key (e.g. matches your DB transaction id) so retries
// from your side are also idempotent end-to-end
const tx2 = await sdk.users.fund('user-42', { amount: '50.00' }, {
  idempotencyKey: 'tx-abc123',
});

if (tx2.idempotent) {
  // Replay of a previous successful call with the same key.
}
```

## Deposits

```ts
// Gate Pay (gateway-hosted crypto)
const chains = await u.deposits.gate.chains();
const quote = await u.deposits.gate.quote({ currency: 'USDT', amount: '100.00' });
const dep = await u.deposits.gate.create({ quoteToken: quote.quoteToken, chain: 'TRX' });
//   → redirect user to dep.whitelabelUrl, or render dep.onChain.address

// Onramp (card payment)
const session = await u.deposits.onramp.session({
  payAmount: 50, payCurrency: 'EUR', redirectUrl: 'https://your.app/done',
});
//   → redirect user to session.whitelabelUrl

// Self-hosted EVM crypto
const addr = await u.deposits.crypto.address();
const cQuote = await u.deposits.crypto.quote({ token: 'USDT', amount: 100 });

// Cancel / resume any in-progress deposit
await u.deposits.cancel(dep.fundingId);
await u.deposits.resume(dep.fundingId);
```

## Webhooks

Configure your webhook URL + secret in the merchant dashboard. Pass the secret
to the constructor, then verify inbound requests via `sdk.verifyWebhook(...)`:

```ts
import { Skinshark, isError } from '@skinshark/sdk';
import express from 'express';

const sdk = new Skinshark({
  apiKey: process.env.SKINSHARK_API_KEY!,
  webhookSecret: process.env.SKINSHARK_WH_SECRET!,
});

const app = express();

// IMPORTANT: pass the RAW body bytes — JSON middleware would re-stringify and
// break the signature.
app.post('/webhooks/skinshark',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    try {
      const event = sdk.verifyWebhook(req.body, req.headers);

      switch (event.type) {
        case 'trade.completed':  /* event.data.trade */ break;
        case 'trade.failed':     /* event.data.trade.error */ break;
        case 'deposit.completed':/* event.data.deposit */ break;
        // ...
      }

      res.status(204).end();
    } catch (e) {
      if (isError(e, 'INVALID_SIGNATURE')) return res.status(401).end();
      throw e;
    }
  },
);
```

Per-call override (e.g. during secret rotation, or when one client serves
multiple webhook endpoints with different secrets):

```ts
sdk.verifyWebhook(req.body, req.headers, {
  secret: process.env.SKINSHARK_WH_SECRET_NEW!,
  toleranceSeconds: 60,  // tighter replay window than the 300s default
});
```

Or use the standalone `verifyWebhook` if you don't want to instantiate a client
(serverless cold-start handlers, edge functions):

```ts
import { verifyWebhook } from '@skinshark/sdk';

const event = verifyWebhook(req.body, req.headers, {
  secret: process.env.SKINSHARK_WH_SECRET!,
});
```

## Enum casing

All status/type enums on the wire are **lowercase**:

```
TradeStatus    initiated / pending / active / hold / completed / failed / reverted
TradeType      buy / sell
RevertedBy     supplier / user
DeliveryMode   standard / instant
```

Other lowercase enums:

```
UserStatus      active / suspended / deleted
WalletStatus    active / suspended / closed
DepositStatus   initiated / pending / completed / partial / expired / cancelled / refunded / failed
WalletType      spot / earnings
DepositMethod   gatepay / onramp / crypto
TwoFactorMethod email / totp
```

(Currency / token symbols like `USD`, `EUR`, `USDT`, `USDC` are uppercase per
their domain convention. CS2 community labels like `StatTrak` and `Phase 1`
keep their natural casing.)

## Errors

A single `SkinsharkError` class is thrown for every failure. Use the discriminated
`key` for branching, the `code` (numeric) for logs, and the typed guards for groups.

```ts
import {
  Skinshark, SkinsharkError,
  isError, isAuthError, isRateLimited, isValidationError,
} from '@skinshark/sdk';

try {
  await sdk.market.buy(items, 'order-1', { onBehalfOf: 'u-1' });
} catch (e) {
  if (!(e instanceof SkinsharkError)) throw e;

  console.error({
    key: e.key,
    code: e.code,
    status: e.status,
    requestId: e.requestId,    // include in support tickets
    retryAfterMs: e.retryAfterMs,
  });

  if (isError(e, 'INSUFFICIENT_BALANCE')) {/* refill */}
  if (isError(e, 'PRICE_MISMATCH'))       {/* refresh listing */}
  if (isError(e, 'TRADEURL_REQUIRED'))    {/* prompt user */}
  if (isAuthError(e))                     {/* rotate key, check IP allowlist */}
  if (isRateLimited(e))                   {await sleep(e.retryAfterMs ?? 1000);}
  if (isValidationError(e))               {/* probably a programmer error */}
}
```

## Response metadata

The unwrapped response is the data you want. The envelope's `requestId` and
HTTP details live on a non-enumerable Symbol — read them via `meta()`:

```ts
import { meta } from '@skinshark/sdk';

const profile = await sdk.account.get();
const m = meta(profile);
m?.requestId   // 'req-...'
m?.status      // 200
m?.rateLimit   // { limit, remaining, resetAt } if the response carried it
```

## Configuration

```ts
new Skinshark({
  apiKey: '...',                  // required
  webhookSecret: '...',           // optional — enables sdk.verifyWebhook() without per-call secret
  baseUrl: 'https://api.skinshark.gg',  // default
  timeoutMs: 30_000,              // per-request, default 30s
  retries: { max: 3, baseDelayMs: 200 },   // 429 + 5xx with Retry-After honored
  // retries: false,              // disable
  userAgent: '@my-app/1.2.3',
  debug: true,                    // or (event) => myLogger(event)
});
```

### Performance tuning (Node only)

The SDK uses `got` under the hood. To tune connection pooling for high-throughput
workloads, set a global undici dispatcher BEFORE constructing the client:

```ts
import { Agent, setGlobalDispatcher } from 'undici';
setGlobalDispatcher(new Agent({ keepAliveTimeout: 30_000, connections: 50 }));
```

## Type-only imports

The wire types are also reachable from a subpath that has no runtime cost:

```ts
import type { Trade, MarketListing, BuyBody, ErrorKey } from '@skinshark/sdk/types';
```

## Escape hatch

If we haven't wrapped an endpoint yet, you can call it through the same auth +
retry + envelope-unwrap pipeline:

```ts
const data = await sdk.request<MyShape>({
  method: 'POST',
  path: '/some/new/endpoint',
  query: { foo: 'bar' },
  body: { ... },
  opts: { onBehalfOf: 'u-1' },
});
```

## License

Proprietary. See LICENSE.
