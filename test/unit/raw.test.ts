import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { Skinshark, isError, meta } from '../../src/index.js';

const BASE = 'https://api.skinshark.gg';
const API_KEY = 'sk_test_raw';

beforeEach(() => {
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
});
afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

describe('sdk.raw — untyped endpoints', () => {
  it('gets an unwrapped payload with auth, query and meta', async () => {
    nock(BASE, { reqheaders: { 'api-key': API_KEY } })
      .get('/internal/coverage')
      .query({ since: '2026-08-01', limit: '10' })
      .reply(200, {
        requestId: 'raw-1', success: true,
        data: { items: 4, covered: 3 },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const data = await sdk.raw.get<{ items: number; covered: number }>(
      '/internal/coverage',
      { since: '2026-08-01', limit: 10 },
    );

    expect(data.covered).toBe(3);
    expect(meta(data)?.requestId).toBe('raw-1');
  });

  it('posts a body and honours an idempotency key', async () => {
    nock(BASE, { reqheaders: { 'Idempotency-Key': 'key-1' } })
      .post('/internal/jobs', { kind: 'reprice' })
      .reply(200, { requestId: 'raw-2', success: true, data: { id: 'job-1' } });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const res = await sdk.raw.post<{ id: string }>(
      '/internal/jobs',
      { kind: 'reprice' },
      { idempotencyKey: 'key-1' },
    );

    expect(res.id).toBe('job-1');
  });

  it('accepts a path with or without a leading slash', async () => {
    nock(BASE).get('/internal/ping').twice()
      .reply(200, { requestId: 'raw-3', success: true, data: { ok: true } });

    const sdk = new Skinshark({ apiKey: API_KEY });
    await expect(sdk.raw.get('/internal/ping')).resolves.toEqual({ ok: true });
    await expect(sdk.raw.get('internal/ping')).resolves.toEqual({ ok: true });
  });

  it('sends query and body together via raw.request', async () => {
    nock(BASE)
      .put('/internal/thing', { name: 'x' })
      .query({ mode: 'upsert' })
      .reply(200, { requestId: 'raw-4', success: true, data: { updated: 1 } });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const res = await sdk.raw.request<{ updated: number }>({
      method: 'PUT',
      path: '/internal/thing',
      query: { mode: 'upsert' },
      body: { name: 'x' },
    });

    expect(res.updated).toBe(1);
  });

  it('deletes and maps server errors to SkinsharkError', async () => {
    nock(BASE)
      .delete('/internal/thing/1')
      .reply(404, {
        requestId: 'raw-5', success: false,
        error: { code: 1404, key: 'NOT_FOUND', message: 'gone' },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const err = await sdk.raw.delete('/internal/thing/1').catch((e: unknown) => e);

    expect(isError(err, 'NOT_FOUND')).toBe(true);
  });

  it('binds On-Behalf-Of on a scoped client', async () => {
    nock(BASE)
      .get('/merchant/users/customer-42')
      .reply(200, {
        requestId: 'raw-6', success: true,
        data: {
          id: '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000',
          externalId: 'customer-42', email: null, steamId: null,
          status: 'active', feeBps: 100, wallet: { currency: 'USD', balance: 12 },
          createdAt: '2026-01-01T00:00:00Z',
        },
      });
    nock(BASE, { reqheaders: { 'On-Behalf-Of': '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0000' } })
      .post('/internal/whatever', { name: 'x' })
      .reply(200, { requestId: 'raw-7', success: true, data: { ok: true } });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const user = await sdk.as('customer-42');

    await expect(user.raw.post('/internal/whatever', { name: 'x' })).resolves.toEqual({ ok: true });
  });

  it('keeps sdk.request working as an alias', async () => {
    nock(BASE)
      .post('/internal/legacy')
      .reply(200, { requestId: 'raw-8', success: true, data: { ok: true } });

    const sdk = new Skinshark({ apiKey: API_KEY });
    await expect(sdk.request({ method: 'POST', path: '/internal/legacy' })).resolves.toEqual({ ok: true });
  });
});
