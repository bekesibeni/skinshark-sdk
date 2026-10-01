import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { Skinshark, SkinsharkError } from '../../src/index.js';

const BASE = 'https://api.skinshark.gg';
const API_KEY = 'sk_test_abcdef';
const LISTING = '00000000-0000-0000-0000-000000000001';

const buyOk = {
  requestId: 'req-ok', success: true,
  data: { id: 't-1', status: 'initiated', itemCount: 1, totalPrice: 5, currency: 'USD', createdAt: '2026-01-01T00:00:00Z' },
};

beforeEach(() => {
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

describe('error meta', () => {
  it('carries envelope extras such as listingIds on the error', async () => {
    nock(BASE)
      .post('/market/buy')
      .reply(404, {
        requestId: 'req-m1', success: false,
        error: { code: 2011, key: 'LISTING_NOT_FOUND', message: 'Listing not found', listingIds: [LISTING] },
      });

    const sdk = new Skinshark({ apiKey: API_KEY, retries: false });
    const err = await sdk.market.buy([{ listingId: LISTING, maxPrice: '5.00' }]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SkinsharkError);
    expect((err as SkinsharkError).meta).toEqual({ listingIds: [LISTING] });
  });
});

describe('buy idempotency', () => {
  it('generates one externalId and reuses it across retries', async () => {
    const seen: string[] = [];
    nock(BASE)
      .post('/market/buy', (body: { externalId: string }) => { seen.push(body.externalId); return true; })
      .reply(503, { requestId: 'req-i1', success: false, error: { code: 2000, key: 'MARKET_UNAVAILABLE', message: 'x' } })
      .post('/market/buy', (body: { externalId: string }) => { seen.push(body.externalId); return true; })
      .reply(201, buyOk);

    const sdk = new Skinshark({ apiKey: API_KEY, retries: { baseDelayMs: 1 } });
    const res = await sdk.market.buy([{ listingId: LISTING, maxPrice: '5.00' }]);
    expect(res.id).toBe('t-1');
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[1]).toBe(seen[0]);
  });
});
