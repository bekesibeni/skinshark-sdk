# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # tsup --watch
npm run build            # tsup: ESM + .d.ts to dist/
npm run typecheck        # tsc --noEmit
npm test                 # vitest run (unit, mocked with nock)
npm run test:watch       # vitest (watch mode)
npm run test:integration # vitest with integration config (live API, env-gated)
npx vitest run test/unit/users.test.ts            # single file
npx vitest run test/unit/client.test.ts -t "isError"  # by test name
```

Integration tests skip unless `SKINSHARK_TEST_API_KEY` is set. The full mutating flow (`test/integration/full-flow.test.ts`) additionally requires `SKINSHARK_RUN_FULL_FLOW=1` so it doesn't fire by accident — it creates and deletes a real sub-user.

```bash
SKINSHARK_TEST_API_KEY=sk_... \
SKINSHARK_TEST_BASE_URL=https://api-staging.skinshark.gg \
npm run test:integration

# Mutating flow (creates + deletes a sub-user):
SKINSHARK_RUN_FULL_FLOW=1 SKINSHARK_TEST_API_KEY=... npm run test:integration
```

## Architecture

**Stack:** got 15 (HTTP), TypeScript 6 ESNext, ESM-only, Node 22+. tsup for build, vitest + nock for tests. Zero runtime deps besides got.

**Source of truth:** `openapi.yaml` at the repo root mirrors the SkinShark Merchant API exactly. Wire types in `src/types/api.ts` are hand-derived from it. When the spec changes, update the types and the matching module method together.

### Two contexts, one surface

Every endpoint runs as either **the merchant** (no `On-Behalf-Of` header, hits `/merchant/*`) or **a sub-user** (with `On-Behalf-Of`, hits `/user/*` and `/market/*`). The SDK exposes both:

- **Top-level modules** (`sdk.account`, `sdk.users`, `sdk.trades`) are merchant-only.
- **Actor-context modules** (`sdk.profile`, `sdk.tradeUrls`, `sdk.wallet`, `sdk.deposits`, `sdk.market`) run as the merchant by default. Pass `{ onBehalfOf: id }` in `RequestOptions` to flip to a sub-user.
- **`sdk.as(ref)`** is async — it validates ownership via `GET /merchant/users/{id}` (gives us the resolved UUID + externalId + status + balance), then returns a `ScopedClient` that auto-injects `On-Behalf-Of` on every call. The scoped client only exposes actor-context modules; merchant-only modules are absent because the API rejects `On-Behalf-Of` on `/merchant/*`.

When adding a new endpoint, decide which axis it lives on:

- Merchant-only → top-level module, no `onBehalfOf` plumbing
- Actor-context → top-level module **and** mirror it onto `ScopedClient` in `src/modules/scoped.ts`

### HTTP layer (`src/internal/http.ts`)

`HttpClient.request<T>(method, path, init)` is the single chokepoint for every API call. It uses `got.extend` with three hooks doing the cross-cutting work:

- **`beforeRequest`** — inject `api-key`, `user-agent`, `On-Behalf-Of`, `Idempotency-Key` from the per-call `context: CallContext`. Modules pass `onBehalfOf` and `idempotencyKey` via `RequestOptions`; the request helper translates them into context values that the hook reads.
- **`beforeRetry`** — debug hook for retry events. Idempotency-Keys are preserved across got's automatic retries (NOT regenerated), which is the correct behavior for the API's idempotency contract.
- **`afterResponse`** — debug hook for response events. The actual envelope unwrap and error mapping happen in `request<T>` itself, not in hooks.

Retry policy: 408/429/5xx, exponential + jitter, `Retry-After` honored. `calculateDelay` floors at 1ms because got treats 0 as "stop retrying" — don't change this.

`mapError` converts got's `HTTPError` / `RequestError` / `TimeoutError` into a single `SkinsharkError` with the right `key` from the envelope when present. Network-level failures get SDK-side keys (`SDK_TIMEOUT`, `SDK_NETWORK`, `SDK_ABORTED`).

### Envelope + meta

Every successful response unwraps to `data` directly. The envelope's `requestId` and HTTP details are attached via a `Symbol.for('@skinshark/sdk.meta')` non-enumerable property on the data — read with the `meta()` helper. This keeps the ergonomic path clean (consumers get the data they want) while preserving observability for support/debugging. See `src/meta.ts`.

`null`/`undefined` responses (e.g. DELETE) skip the meta attachment since there's nowhere to attach it.

### Errors (`src/errors.ts` + `src/types/errors.ts`)

One class — `SkinsharkError` — for every failure. Branching is via discriminated `key: ErrorKey` (~110 server keys + 4 SDK-side keys + open-ended `string & {}` fallback for unknown server keys). Plus four typed guards: `isError(e, key)`, `isAuthError`, `isRateLimited`, `isValidationError`.

Don't add a subclass per error key. Don't move keys into runtime enums. The `(string & {})` trick on the `ErrorKey` union keeps autocomplete for known keys while accepting unknown ones — preserve it when editing the union.

The `AUTH_ERROR_KEYS` / `VALIDATION_ERROR_KEYS` / `RATE_LIMIT_ERROR_KEYS` sets in `src/types/errors.ts` drive the category guards. Add new keys to the appropriate set when extending the union.

### Module pattern

Each domain is a class in `src/modules/{name}.ts` taking an `HttpClient` and exposing plain async methods. The class is namespacing only — no inheritance, no DI, no decorators. Methods translate path/query/body args into `http.request<T>(method, path, init)` calls. Path params use `encodeURIComponent`.

Method signature recipe (in this order):

1. Path params (positional, required)
2. Body or filter bag (positional, required if there's no opts-only signature)
3. `externalId?` (positional, optional — only for `market.buy` / `market.quickBuy`)
4. `opts?: RequestOptions` (always last, always optional)

`RequestOptions` is the universal cross-cutting bag: `onBehalfOf`, `idempotencyKey`, `signal`, `timeoutMs`, `retries`, `headers`. For endpoints with optional body fields like `tradeUrl`, the per-endpoint `BuyOptions` extends `RequestOptions` so consumers don't deal with two bags.

### `sdk.as(ref)` and `ScopedClient`

`buildScoped(http, ref)` in `src/modules/scoped.ts` calls `GET /merchant/users/{ref}` (UUID or externalId both work) and constructs a `ScopedClient` with the snapshot fields cached (id, externalId, email, steamId, currency, balance, status, feeBps, createdAt) plus the actor-context modules.

Scoped modules **reuse the existing module classes** — there's no separate `ScopedMarket` etc. The trick is `HttpClient.withDefaults({ onBehalfOf })`: it returns a thin proxy that injects defaults into every `request()` call. The scoped client builds one bound HttpClient and constructs `MarketModule`/`TradeUrlsModule`/`WalletModule`/`DepositsModule`/`ProfileModule` against it. This keeps a single source of truth — adding an endpoint to `MarketModule` automatically reflects on `ScopedClient.market` with no second-place edit.

The scope is bound to the canonical UUID (not the original ref), so the scoped client survives an externalId rename mid-session. The "subset" property — that scoped clients can't accidentally call merchant-only modules — comes from simply not constructing them, not from a parallel type hierarchy.

### Idempotency (`src/internal/idempotency.ts`)

`newIdempotencyKey()` wraps Node's stdlib `crypto.randomUUID()` (UUIDv4). Order doesn't matter for idempotency — only uniqueness. `users.fund` auto-generates a key when the consumer doesn't pass one; public via `sdk.newIdempotencyKey()` for consumers who want to pre-allocate. The HTTP layer also uses the presence of `idempotencyKey` to widen the default retry method list to include POST/PATCH (see `internal/http.ts`).

### Webhooks (`src/webhooks.ts`)

`verifyWebhook(rawBody, headers, { secret, toleranceSeconds? })` is **standalone** — it doesn't depend on the HTTP client and doesn't share state. The signing scheme matches Standard Webhooks: HMAC-SHA256 over `${id}.${timestamp}.${body}`, signature header `t=<ts>,s=<sig>[,s1=<old>]`. `s1=` is the rotation slot.

Always pass the **raw** body bytes — JSON middleware that re-stringifies will break the signature. Use timing-safe comparison (`timingSafeEqual` on equal-length buffers).

### Branded IDs (`src/types/branded.ts`)

`ListingId`, `TradeId`, `ItemId`, `FundingId`, `DepositId`, `TradeUrlId`, `WalletId`, `TransactionId`, `SubUserUuid`, `MerchantId` are all `string & { __brand }` types. Returned values from the API are typed as branded; method inputs accept `string | BrandedId`. Don't try to brand `SubUserRef` or `TradeRef` — those accept either UUID or merchant-supplied externalId at the API level, so they stay plain `string`.

### Build + exports (`tsup.config.ts`, `package.json`)

Two entry points:

- `.` (`src/index.ts`) — runtime exports + types
- `./types` (`src/types/index.ts`) — type-only subpath for consumers who want the wire types without the runtime client

ESM-only. `tsconfig.json` sets `"ignoreDeprecations": "6.0"` because tsup's internal `baseUrl` triggers a TS6 warning that we don't control.

## Conventions

- **Static imports only** — never `await import()`. Matches the API repo convention.
- **`.js` extension on imports** even from `.ts` source — required by `moduleResolution: NodeNext`.
- **No classes for behavior, classes for namespacing** — modules are classes only to group related methods under a single field on `Skinshark`. Methods are plain async functions.
- **Comments**: short single-line "why" comments only, on non-obvious decisions (cache TTL choices, retry-floor of 1ms, etc). No multi-line module headers, no "this function does X" comments.
- **Money is pass-through**: numbers for decimal currency fields (`5.23`), strings for `*Cents` fields (`"15000"`). Never auto-parse. Same for ISO date strings — never auto-parse to `Date`.
- **No runtime validation** of responses. Types only. The SDK trusts the API.
- **All status/type enums on the wire are lowercase** (`TradeStatus`, `TradeType`, `RevertedBy`, `DeliveryMode`, `UserStatus`, `WalletStatus`, `DepositStatus`, `WalletType`, `DepositMethod`, `TwoFactorMethod`). Currency/token symbols (USD, EUR, USDT, USDC) are uppercase per their domain convention. CS2 community labels (StatTrak, Phase 1) keep their natural casing.
- **No proxy support, no browser support, no edge-runtime support** as stated targets — Node 22+ first, Bun via Node compat. Don't add polyfills.
- **Tests**: nock for HTTP mocking. Unit tests in `test/unit/`, integration in `test/integration/`. The integration suite runs against staging when env vars are set.

## API source

`openapi.yaml` at the root is the OpenAPI 3.1 spec for the SkinShark Merchant API (currently version 0.2.6). It's the canonical source for every endpoint shape. When the API changes, update both the spec file and the matching wire types in `src/types/api.ts` together.
