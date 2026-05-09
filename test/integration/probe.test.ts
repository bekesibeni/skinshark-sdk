import { describe, expect, it } from 'vitest';
import { Skinshark, meta } from '../../src/index.js';

const API_KEY = process.env.SKINSHARK_TEST_API_KEY;
const BASE_URL = process.env.SKINSHARK_TEST_BASE_URL ?? 'https://api.skinshark.gg';

const itLive = API_KEY ? it : it.skip;

describe('integration — wire-compat probe', () => {
  itLive('account.get returns a typed merchant profile', async () => {
    const sdk = new Skinshark({ apiKey: API_KEY!, baseUrl: BASE_URL });
    const m = await sdk.account.get();
    expect(typeof m.id).toBe('string');
    expect(typeof m.email).toBe('string');
    expect(typeof m.feeBps).toBe('number');
    expect(typeof m.merchantFeeBps).toBe('number');
    expect(m.wallets).toBeDefined();
    console.log('merchant', { id: m.id, feeBps: m.feeBps, merchantFeeBps: m.merchantFeeBps });
  });

  itLive('account.fees returns the fee config', async () => {
    const sdk = new Skinshark({ apiKey: API_KEY!, baseUrl: BASE_URL });
    const f = await sdk.account.fees();
    expect(typeof f.merchantFeeBps).toBe('number');
    expect(typeof f.globalDefaultFeeBps).toBe('number');
    expect(typeof f.effectiveChildFeeBps).toBe('number');
    console.log('fees', f);
  });

  itLive('account.wallet returns spot wallet', async () => {
    const sdk = new Skinshark({ apiKey: API_KEY!, baseUrl: BASE_URL });
    const w = await sdk.account.wallet({ type: 'spot' });
    expect(typeof w.walletId).toBe('string');
    expect(typeof w.balance).toBe('number');
    expect(['USD', 'EUR']).toContain(w.currency);
    console.log('wallet', w);
  });

  itLive('users.list paginates', async () => {
    const sdk = new Skinshark({ apiKey: API_KEY!, baseUrl: BASE_URL });
    const r = await sdk.users.list({ page: 1, limit: 5 });
    expect(Array.isArray(r.users)).toBe(true);
    expect(typeof r.total).toBe('number');
    expect(r.page).toBe(1);
    console.log('users', { total: r.total, totalPages: r.totalPages, returned: r.users.length });
  });

  itLive('account.stats returns totals + bySubUser', async () => {
    const sdk = new Skinshark({ apiKey: API_KEY!, baseUrl: BASE_URL });
    const s = await sdk.account.stats();
    expect(s.totals).toBeDefined();
    expect(typeof s.totals.tradeCount).toBe('number');
    expect(Array.isArray(s.bySubUser)).toBe(true);
    expect(s.byStatus).toBeDefined();
    console.log('stats.totals', s.totals);
  });

  itLive('trades.list returns cursor-paginated items', async () => {
    const sdk = new Skinshark({ apiKey: API_KEY!, baseUrl: BASE_URL });
    const r = await sdk.trades.list({ limit: 3 });
    expect(Array.isArray(r.items)).toBe(true);
    // nextCursor: string | null — null on last page
    expect(r.nextCursor === null || typeof r.nextCursor === 'string').toBe(true);
    console.log('trades', { count: r.items.length, nextCursor: r.nextCursor });
  });

  itLive('market.search works in merchant context (no onBehalfOf)', async () => {
    const sdk = new Skinshark({ apiKey: API_KEY!, baseUrl: BASE_URL });
    const r = await sdk.market.search({ q: 'AK', limit: 3 });
    expect(Array.isArray(r.items)).toBe(true);
    expect(typeof r.total).toBe('number');
    console.log('search', { total: r.total, returned: r.items.length });
  });

  itLive('meta() exposes requestId for support tickets', async () => {
    const sdk = new Skinshark({ apiKey: API_KEY!, baseUrl: BASE_URL });
    const m = await sdk.account.get();
    const meta_ = meta(m);
    expect(meta_?.requestId).toBeTruthy();
    expect(meta_?.status).toBe(200);
    console.log('meta', { requestId: meta_?.requestId, status: meta_?.status });
  });
});
