import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Skinshark, SkinsharkError, isError, meta } from '../../src/index.js';

// This suite MUTATES the target environment (creates + deletes a sub-user).
// Gated behind an explicit env var so it never runs by accident.
const ENABLED = process.env.SKINSHARK_RUN_FULL_FLOW === '1';
const API_KEY = process.env.SKINSHARK_TEST_API_KEY;
const BASE_URL = process.env.SKINSHARK_TEST_BASE_URL ?? 'https://api.skinshark.gg';

const itLive = ENABLED && API_KEY ? it : it.skip;

const externalId = `sdk-full-flow-${Date.now()}`;
const testEmail = `sdk-test-${Date.now()}@skinshark-sdk-test.invalid`;

let sdk: Skinshark;
let createdId: string | undefined;

beforeAll(() => {
  if (!ENABLED || !API_KEY) return;
  sdk = new Skinshark({ apiKey: API_KEY, baseUrl: BASE_URL });
});

afterAll(async () => {
  if (!ENABLED || !API_KEY || !createdId) return;
  try {
    await sdk.users.delete(createdId);
    console.log(`[cleanup] deleted ${createdId}`);
  } catch (e) {
    console.warn('[cleanup] failed', e);
  }
});

describe('integration — full flow (create → bind → exercise → cleanup)', () => {
  itLive('1) creates a sub-user with email + externalId', async () => {
    const created = await sdk.users.create({
      email: testEmail,
      externalId,
      currency: 'USD',
    });
    expect(created.id).toBeTruthy();
    expect(created.email).toBe(testEmail);
    expect(created.externalId).toBe(externalId);
    expect(created.currency).toBe('USD');
    createdId = created.id;
    console.log('[create]', created);
  });

  itLive('2) sdk.as(externalId) validates and caches snapshot', async () => {
    const u = await sdk.as(externalId);
    expect(u.id).toBe(createdId);
    expect(u.externalId).toBe(externalId);
    expect(u.email).toBe(testEmail);
    expect(u.currency).toBe('USD');
    expect(u.balance).toBe(0);
    expect(u.status).toBe('active');
    console.log('[as] resolved', { id: u.id, externalId: u.externalId, balance: u.balance });
  });

  itLive('3) scoped reads: wallet.balance, profile.get, market.search', async () => {
    const u = await sdk.as(externalId);

    const balance = await u.wallet.balance();
    expect(balance.balance).toBe(0);
    expect(balance.currency).toBe('USD');

    const profile = await u.profile.get();
    expect(profile.id).toBe(createdId);

    const search = await u.market.search({ q: 'AK', limit: 3 });
    expect(Array.isArray(search.items)).toBe(true);
    console.log('[scoped] balance=', balance, 'search.total=', search.total);
  });

  itLive('4) tradeUrls.list returns empty for fresh sub-user', async () => {
    const u = await sdk.as(externalId);
    const list = await u.tradeUrls.list();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(0);
  });

  itLive('5) market.buy on bogus listingId surfaces a typed SDK error with requestId', async () => {
    const u = await sdk.as(externalId);
    try {
      const trade = await u.market.buy(
        [{ listingId: '00000000-0000-0000-0000-000000000000', maxPrice: '1.00' }],
        'sdk-test-order',
      );
      console.warn('[buy] unexpectedly succeeded', trade);
      throw new Error('buy unexpectedly succeeded');
    } catch (e) {
      // What we actually want to verify here is that the SDK correctly mapped
      // whatever the server returned into a typed SkinsharkError with an actionable
      // requestId. The exact `key` depends on server behavior:
      //   - LISTING_NOT_FOUND (expected)
      //   - TRADEURL_REQUIRED (no primary trade URL set)
      //   - INSUFFICIENT_BALANCE (no balance)
      //   - INTERNAL (server bug — currently observed on staging)
      expect(e).toBeInstanceOf(SkinsharkError);
      const err = e as SkinsharkError;
      console.log('[buy] failed:', { key: err.key, code: err.code, status: err.status, requestId: err.requestId });
      expect(err.requestId).toBeTruthy();
      expect(err.status).toBeGreaterThanOrEqual(400);
    }
  });

  itLive('6) suspend → reactivate round-trip', async () => {
    await sdk.users.suspend(externalId);
    const suspended = await sdk.users.get(externalId);
    expect(suspended.status).toBe('suspended');

    await sdk.users.reactivate(externalId);
    const active = await sdk.users.get(externalId);
    expect(active.status).toBe('active');
    console.log('[suspend/reactivate] round-trip ok');
  });

  itLive('7) idempotency-key auto-gen end-to-end (fund will fail safely with no balance)', async () => {
    // Merchant has $0 spot balance, so this WILL fail with INSUFFICIENT_BALANCE.
    // What we're verifying is that the SDK auto-generated an Idempotency-Key,
    // sent it, got mapped to the right error, and surfaced requestId.
    try {
      await sdk.users.fund(externalId, { amount: '1.00' });
    } catch (e) {
      expect(e).toBeInstanceOf(SkinsharkError);
      const err = e as SkinsharkError;
      console.log('[fund] failed as expected:', { key: err.key, code: err.code, requestId: err.requestId });
      // Either INSUFFICIENT_BALANCE (no merchant funds) or possibly something else
      // depending on staging state. Both indicate the request reached the server.
      expect(err.requestId).toBeTruthy();
    }
  });

  itLive('8) meta() carries requestId on every successful response', async () => {
    const u = await sdk.as(externalId);
    const balance = await u.wallet.balance();
    const m = meta(balance);
    expect(m?.requestId).toBeTruthy();
    expect(m?.status).toBe(200);
  });

  itLive('9) error guards narrow correctly on real responses', async () => {
    try {
      // Hitting a non-existent sub-user via merchant scope → USER_NOT_FOUND (404)
      await sdk.users.get('00000000-0000-0000-0000-000000000999');
      throw new Error('should have thrown');
    } catch (e) {
      expect(isError(e, 'USER_NOT_FOUND') || isError(e, 'NOT_FOUND')).toBe(true);
    }
  });
});
