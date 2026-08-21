import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
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

describe('sdk.raw.fetch — envelope-free routes', () => {
  // Export lanes hijack the reply and write NDJSON, so there is no envelope to unwrap and
  // JSON.parse dies on line 2. Reading them at all depends on this path staying envelope-free.
  it('returns a gzipped NDJSON body undecoded, with headers', async () => {
    const body = [
      JSON.stringify({ lane: 'eco-topbook', version: 7 }),
      JSON.stringify({ id: 'a', price: 1.5 }),
      '',
    ].join('\n');

    nock(BASE, { reqheaders: { 'api-key': API_KEY, accept: 'application/x-ndjson' } })
      .get('/market/exports/eco-topbook')
      .reply(200, gzipSync(Buffer.from(body)), {
        'content-type': 'application/x-ndjson',
        'content-encoding': 'gzip',
        etag: '"eco-topbook-7"',
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const res = await sdk.raw.fetch({
      path: '/market/exports/eco-topbook',
      opts: { headers: { accept: 'application/x-ndjson' } },
    });

    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe('"eco-topbook-7"');
    expect(res.body.trimEnd().split('\n')).toHaveLength(2);
  });

  // A conditional poll's whole point is the 304. Throwing on it would make ETag caching
  // indistinguishable from a failed pull.
  it('returns a 304 rather than throwing', async () => {
    nock(BASE, { reqheaders: { 'if-none-match': '"eco-topbook-7"' } })
      .get('/market/exports/eco-topbook')
      .reply(304, '', { 'x-export-next-update': '2026-08-21T21:00:00Z' });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const res = await sdk.raw.fetch({
      path: '/market/exports/eco-topbook',
      opts: { headers: { 'if-none-match': '"eco-topbook-7"' } },
    });

    expect(res.status).toBe(304);
    expect(res.headers['x-export-next-update']).toBe('2026-08-21T21:00:00Z');
  });

  it('still maps HTTP failures to SkinsharkError unless accepted', async () => {
    nock(BASE).get('/market/exports/eco-topbook').twice()
      .reply(403, { requestId: 'r', success: false, error: { code: 1002, key: 'FORBIDDEN', message: 'no' } });

    const sdk = new Skinshark({ apiKey: API_KEY, retries: false });
    await expect(sdk.raw.fetch({ path: '/market/exports/eco-topbook' })).rejects.toSatisfy(
      (e: unknown) => isError(e, 'FORBIDDEN'),
    );

    const accepted = await sdk.raw.fetch({
      path: '/market/exports/eco-topbook',
      acceptStatus: [403],
    });
    expect(accepted.status).toBe(403);
  });
});
