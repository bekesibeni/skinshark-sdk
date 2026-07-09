import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { Skinshark, isError } from '../../src/index.js';

const BASE = 'https://api.skinshark.gg';
const API_KEY = 'sk_test_sell';

beforeEach(() => {
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
});
afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

describe('market.sell — pricing reads', () => {
  it('fetches the payout book with a search filter', async () => {
    nock(BASE, { reqheaders: { 'api-key': API_KEY } })
      .get('/market/sell/prices')
      .query({ search: 'AK-47 | Redline', limit: '50' })
      .reply(200, {
        requestId: 'r1', success: true,
        data: [{ marketHashName: 'AK-47 | Redline (Field-Tested)', deposit: 4.2, accepted: true }],
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const book = await sdk.market.sell.prices({ search: 'AK-47 | Redline', limit: 50 });
    expect(book[0]?.deposit).toBe(4.2);
    expect(book[0]?.accepted).toBe(true);
  });

  it('prices the sub-user inventory via On-Behalf-Of', async () => {
    nock(BASE, { reqheaders: { 'On-Behalf-Of': 'user-42' } })
      .get('/market/sell/inventory')
      .query({ refresh: 'true' })
      .reply(200, {
        requestId: 'r2', success: true,
        data: {
          items: [
            { id: 'enc-1', assetid: '9001', name: 'AK-47 | Redline', marketHashName: 'AK-47 | Redline (FT)', type: 'Rifle', iconUrl: 'hash', tradable: true, marketPrice: 5.1, price: 4.2, accepted: true },
            { id: 'enc-2', assetid: '9002', name: 'Sticker', marketHashName: 'Sticker', type: 'Sticker', iconUrl: 'hash2', tradable: false, price: 0.1, accepted: false },
          ],
          currency: 'USD',
          count: 2,
        },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const inv = await sdk.market.sell.inventory({ refresh: true }, { onBehalfOf: 'user-42' });
    expect(inv.count).toBe(2);
    expect(inv.currency).toBe('USD');
    expect(inv.items.filter((i) => i.accepted)).toHaveLength(1);
  });
});

describe('market.sell — create', () => {
  it('submits a sale with exact-cent prices, externalId, and tradeUrl override', async () => {
    nock(BASE, { reqheaders: { 'On-Behalf-Of': 'user-42' } })
      .post('/market/sell', {
        items: [{ id: 'enc-1', price: '4.20' }],
        externalId: 'sell-7',
        tradeUrl: 'https://steamcommunity.com/tradeoffer/new/?partner=1&token=abc',
      })
      .reply(201, {
        requestId: 'r3', success: true,
        data: { id: 'trade-1', status: 'initiated', itemCount: 1, totalPrice: 4.2, currency: 'USD', createdAt: '2026-07-09T00:00:00.000Z' },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const sale = await sdk.market.sell.create(
      [{ id: 'enc-1', price: '4.20' }],
      'sell-7',
      { onBehalfOf: 'user-42', tradeUrl: 'https://steamcommunity.com/tradeoffer/new/?partner=1&token=abc' },
    );
    expect(sale.id).toBe('trade-1');
    expect(sale.status).toBe('initiated');
  });

  it('maps PRICE_MISMATCH when the quote drifted', async () => {
    nock(BASE)
      .post('/market/sell')
      .reply(409, {
        requestId: 'r4', success: false,
        error: { code: 2020, key: 'PRICE_MISMATCH', message: 'Listing price drifted above your maxPrice' },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    try {
      await sdk.market.sell.create([{ id: 'enc-1', price: '4.20' }]);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(isError(e, 'PRICE_MISMATCH')).toBe(true);
    }
  });

  it('maps NO_BOTS_AVAILABLE (503)', async () => {
    nock(BASE)
      .post('/market/sell')
      .reply(503, {
        requestId: 'r5', success: false,
        error: { code: 2100, key: 'NO_BOTS_AVAILABLE', message: 'No Steam bots are currently available to process this trade' },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    try {
      await sdk.market.sell.create([{ id: 'enc-1', price: '4.20' }]);
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(isError(e, 'NO_BOTS_AVAILABLE')).toBe(true);
    }
  });
});

describe('market.trades — sell-aware reads', () => {
  it('filters the transaction list by type=sell', async () => {
    nock(BASE)
      .get('/market/transactions')
      .query({ type: 'sell', limit: '25' })
      .reply(200, { requestId: 'r6', success: true, data: { items: [], nextCursor: null } });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const res = await sdk.market.trades.list({ type: 'sell', limit: 25 });
    expect(res.nextCursor).toBeNull();
  });

  it('batch-resolves multiple refs into an array', async () => {
    nock(BASE)
      .get('/market/transactions/t1,t2')
      .reply(200, {
        requestId: 'r7', success: true,
        data: [
          { id: 't1', type: 'sell', userId: 'u1', steamId: 's1', tradeUrl: 'x', status: 'hold', game: '730', items: [], summary: { total: 1, delivered: 1, completed: 0, failed: 0 }, totalPrice: 4.2, currency: 'USD', createdAt: 'c', updatedAt: 'u' },
        ],
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const trades = await sdk.market.trades.get(['t1', 't2']);
    expect(Array.isArray(trades)).toBe(true);
    expect(trades[0]?.type).toBe('sell');
  });

  it('normalizes a single-ref response into an array', async () => {
    nock(BASE)
      .get('/market/transactions/t9')
      .reply(200, {
        requestId: 'r8', success: true,
        data: { id: 't9', type: 'buy', userId: 'u1', steamId: 's1', tradeUrl: 'x', status: 'completed', game: '730', items: [], summary: { total: 1, delivered: 1, completed: 1, failed: 0 }, totalPrice: 1.0, currency: 'USD', createdAt: 'c', updatedAt: 'u' },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const trades = await sdk.market.trades.get(['t9']);
    expect(trades).toHaveLength(1);
    expect(trades[0]?.id).toBe('t9');
  });

  it('short-circuits an empty ref list without a request', async () => {
    const sdk = new Skinshark({ apiKey: API_KEY });
    const trades = await sdk.market.trades.get([]);
    expect(trades).toEqual([]);
  });
});
