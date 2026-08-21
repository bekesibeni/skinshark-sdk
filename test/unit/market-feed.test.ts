import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { Skinshark } from '../../src/index.js';

const BASE = 'https://api.skinshark.gg';
const API_KEY = 'sk_test_feed';

beforeEach(() => {
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
});
afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

describe('market.live — browse page', () => {
  it('pages the feed and reads per-source prices and lane health', async () => {
    nock(BASE, { reqheaders: { 'On-Behalf-Of': 'user-7' } })
      .get('/market')
      .query({ page: '2', limit: '50' })
      .reply(200, {
        requestId: 'feed-1', success: true,
        data: {
          items: [
            {
              id: '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001',
              assetId: '44001', classId: '310776979', instanceId: '188530139',
              name: 'AK-47 | Redline', marketHashName: 'AK-47 | Redline (Field-Tested)',
              type: 'Rifle', iconUrl: 'hash',
              wear: '0.2431', paintSeed: 661,
              previewToken: 'deadbeef00112233',
              delivery: 'instant',
              prices: { c5game: { price: '5.42', updatedAt: '2026-08-21T10:00:00Z' } },
            },
          ],
          total: 1,
          page: 2,
          limit: 50,
          sources: { c5game: { fresh: true, lastProjectedAt: 1756000000000 } },
        },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const feed = await sdk.market.live({ page: 2, limit: 50 }, { onBehalfOf: 'user-7' });

    expect(feed.page).toBe(2);
    expect(feed.sources.c5game?.fresh).toBe(true);
    expect(feed.items[0]?.prices.c5game?.price).toBe('5.42');
    expect(feed.items[0]?.previewToken).toBe('deadbeef00112233');
  });

  it('reports a frozen source alongside an empty page', async () => {
    nock(BASE)
      .get('/market')
      .reply(200, {
        requestId: 'feed-2', success: true,
        data: {
          items: [], total: 0, page: 1, limit: 100,
          sources: { c5game: { fresh: false, lastProjectedAt: null } },
        },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const feed = await sdk.market.live();

    expect(feed.items).toHaveLength(0);
    expect(feed.sources.c5game?.fresh).toBe(false);
    expect(feed.sources.c5game?.lastProjectedAt).toBeNull();
  });
});
