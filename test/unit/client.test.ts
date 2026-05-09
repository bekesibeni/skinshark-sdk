import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { Skinshark, isError, isRateLimited, meta, SkinsharkError } from '../../src/index.js';

const BASE = 'https://api.skinshark.gg';
const API_KEY = 'sk_test_abcdef';

beforeEach(() => {
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

describe('Skinshark client — envelope + auth', () => {
  it('attaches api-key + unwraps envelope on success', async () => {
    nock(BASE, { reqheaders: { 'api-key': API_KEY } })
      .get('/merchant')
      .reply(200, {
        requestId: 'req-1',
        success: true,
        data: {
          id: 'm-1', email: 'm@x.com', emailVerified: true, country: 'HU',
          roles: ['merchant'], twoFactorEnabled: false, twoFactorMethod: null,
          feeBps: 100, merchantFeeBps: 200, childDefaultFeeBps: null,
          wallets: { spot: { currency: 'USD', balance: 50 }, earnings: null },
          createdAt: '2026-01-01T00:00:00Z',
        },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const profile = await sdk.account.get();

    expect(profile.email).toBe('m@x.com');
    expect(profile.merchantFeeBps).toBe(200);
    expect(meta(profile)?.requestId).toBe('req-1');
    expect(meta(profile)?.status).toBe(200);
  });

  it('throws SkinsharkError with key + requestId on envelope failure', async () => {
    nock(BASE)
      .get('/merchant')
      .reply(401, {
        requestId: 'req-2',
        success: false,
        error: { code: 1105, key: 'INVALID_API_KEY', message: 'Invalid API key' },
      });

    const sdk = new Skinshark({ apiKey: 'bogus', retries: false });
    await expect(sdk.account.get()).rejects.toMatchObject({
      name: 'SkinsharkError',
      key: 'INVALID_API_KEY',
      code: 1105,
      status: 401,
      requestId: 'req-2',
    });
  });

  it('isError narrows on key', async () => {
    nock(BASE)
      .post('/market/buy')
      .reply(422, {
        requestId: 'req-3', success: false,
        error: { code: 1700, key: 'INSUFFICIENT_BALANCE', message: 'Insufficient balance' },
      });

    const sdk = new Skinshark({ apiKey: API_KEY, retries: false });
    try {
      await sdk.market.buy([{ listingId: '00000000-0000-0000-0000-000000000001', maxPrice: '5.00' }]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(isError(e, 'INSUFFICIENT_BALANCE')).toBe(true);
      expect(isError(e, 'PRICE_MISMATCH')).toBe(false);
    }
  });
});

describe('On-Behalf-Of injection', () => {
  it('does NOT send On-Behalf-Of when no opts.onBehalfOf', async () => {
    nock(BASE, { badheaders: ['on-behalf-of'] })
      .get('/merchant/fees')
      .reply(200, {
        requestId: 'req-4', success: true,
        data: {
          merchantFeeBps: 200, childDefaultFeeBps: null,
          globalDefaultFeeBps: 100, effectiveChildFeeBps: 100,
        },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    await sdk.account.fees();
  });

  it('sends On-Behalf-Of when opts.onBehalfOf is set', async () => {
    nock(BASE, { reqheaders: { 'on-behalf-of': 'user_42' } })
      .get('/market/search')
      .query({ q: 'AK' })
      .reply(200, {
        requestId: 'req-5', success: true,
        data: { items: [], total: 0, page: 1, limit: 25, totalPages: 0 },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    await sdk.market.search({ q: 'AK' }, { onBehalfOf: 'user_42' });
  });
});

describe('Retry behavior', () => {
  it('retries 429 + Retry-After then succeeds', async () => {
    nock(BASE)
      .get('/merchant')
      .reply(429, { requestId: 'req-r1', success: false, error: { code: 1600, key: 'RATE_LIMITED', message: 'Too many' } }, { 'retry-after': '0' })
      .get('/merchant')
      .reply(200, {
        requestId: 'req-r2', success: true,
        data: {
          id: 'm-1', email: 'm@x.com', emailVerified: true, country: 'HU',
          roles: ['merchant'], twoFactorEnabled: false, twoFactorMethod: null,
          feeBps: 100, merchantFeeBps: 200, childDefaultFeeBps: null,
          wallets: { spot: null, earnings: null },
          createdAt: '2026-01-01T00:00:00Z',
        },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const profile = await sdk.account.get();
    expect(profile.email).toBe('m@x.com');
    expect(meta(profile)?.requestId).toBe('req-r2');
  });

  it('isRateLimited classifies 429 errors', async () => {
    nock(BASE)
      .get('/merchant')
      .reply(429, { requestId: 'req-r3', success: false, error: { code: 1600, key: 'RATE_LIMITED', message: 'Too many' } })
      .persist();

    const sdk = new Skinshark({ apiKey: API_KEY, retries: false });
    try {
      await sdk.account.get();
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SkinsharkError);
      expect(isRateLimited(e)).toBe(true);
    }
  });
});

describe('sdk.as(id)', () => {
  const subUserSnapshot = (overrides: Partial<Record<string, unknown>> = {}) => ({
    id: 'uuid-42',
    email: 'sub@x.com',
    steamId: '76561199000000000',
    externalId: 'ext-42',
    status: 'active',
    feeBps: 100,
    createdAt: '2026-01-01T00:00:00Z',
    wallet: { type: 'spot', status: 'active', currency: 'USD', balance: 100 },
    ...overrides,
  });

  it('validates the sub-user via GET /merchant/users/:id and caches snapshot', async () => {
    nock(BASE, { badheaders: ['on-behalf-of'] })
      .get('/merchant/users/ext-42')
      .reply(200, { requestId: 'req-as1', success: true, data: subUserSnapshot() });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const u = await sdk.as('ext-42');
    expect(u.id).toBe('uuid-42');
    expect(u.externalId).toBe('ext-42');
    expect(u.email).toBe('sub@x.com');
    expect(u.currency).toBe('USD');
    expect(u.balance).toBe(100);
    expect(u.steamId).toBe('76561199000000000');
    expect(u.status).toBe('active');
    expect(u.feeBps).toBe(100);
  });

  it('rejects when sub-user is not found', async () => {
    nock(BASE)
      .get('/merchant/users/bogus')
      .reply(404, {
        requestId: 'req-as2', success: false,
        error: { code: 1401, key: 'USER_NOT_FOUND', message: 'User not found' },
      });

    const sdk = new Skinshark({ apiKey: API_KEY, retries: false });
    await expect(sdk.as('bogus')).rejects.toMatchObject({
      name: 'SkinsharkError', key: 'USER_NOT_FOUND',
    });
  });

  it('scoped market.buy attaches canonical-UUID On-Behalf-Of and externalId in body', async () => {
    nock(BASE)
      .get('/merchant/users/ext-42')
      .reply(200, { requestId: 'req-as3', success: true, data: subUserSnapshot() });

    // Scoped client binds to the canonical UUID, not the original ref —
    // robust against externalId rename mid-session.
    nock(BASE, { reqheaders: { 'on-behalf-of': 'uuid-42' } })
      .post('/market/buy', (body) =>
        Array.isArray(body.items) &&
        body.items[0]?.listingId === 'L1' &&
        body.externalId === 'order-1',
      )
      .reply(201, {
        requestId: 'req-buy', success: true,
        data: { id: 'T1', status: 'PENDING', itemCount: 1, totalPrice: 5, createdAt: '2026-01-01T00:00:00Z' },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const u = await sdk.as('ext-42');
    const trade = await u.market.buy([{ listingId: 'L1', maxPrice: '5.00' }], 'order-1');
    expect(trade.id).toBe('T1');
    expect(trade.status).toBe('PENDING');
  });
});
