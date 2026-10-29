import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { Packr } from 'msgpackr';
import {
  Skinshark,
  isError,
  loadBook,
  meta,
  type BookExportResponse,
  type BookFrame,
  type BookShardLink,
  type WebSocketConstructor,
} from '../../src/index.js';

const BASE = 'https://api.skinshark.gg';
const API_KEY = 'sk_test_book';
const L1 = '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001';
const L2 = '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0002';
const L3 = '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0003';
const ITEM_A = '00a1b2c3d4e5f607';
const ITEM_B = '1111222233334444';
const packr = new Packr({ useRecords: false });

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 1;
  binaryType = 'blob';
  sent: Record<string, unknown>[] = [];
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string, readonly protocols: string[]) {
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code = 1000, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  json(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  msgpack(msg: unknown) {
    const b = packr.pack(msg);
    this.onmessage?.({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
  }

  hello(over: Record<string, unknown> = {}) {
    this.json({ type: 'hello', epoch: '100', seq: 5, level: 'full', feeBps: 300, firehose: true, itemCap: 1000, ...over });
  }
}

const Ctor = FakeSocket as unknown as WebSocketConstructor;
const fast = { baseDelayMs: 1, maxDelayMs: 2 };

function mintTokens(n: number) {
  const scope = nock(BASE);
  for (let i = 0; i < n; i++) {
    scope.post('/auth/ws-token').reply(200, { requestId: `w${i}`, success: true, data: { token: `tok-${i}`, expiresIn: '1h' } });
  }
}

async function nextSocket(count: number): Promise<FakeSocket> {
  await vi.waitFor(() => expect(FakeSocket.instances.length).toBe(count));
  return FakeSocket.instances[count - 1] as FakeSocket;
}

function frame(epoch: string, seq: number, over: Record<string, unknown> = {}) {
  return { type: 'frame', epoch, seq, t: seq * 1000, adds: [], prices: [], removes: [], tops: [], ...over };
}

function shard(url: string, lines: unknown[]): { link: BookShardLink; body: Buffer } {
  const body = gzipSync(Buffer.from(lines.map((l) => JSON.stringify(l)).join('\n') + '\n'));
  return {
    link: { url, rows: lines.length, bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') },
    body,
  };
}

function fakeFetch(bodies: Record<string, Buffer>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const body = bodies[String(url)];
    if (!body) return new Response('gone', { status: 403 });
    return new Response(body, { status: 200 });
  }) as typeof fetch;
}

function exportOf(epoch: string, seq: number, prices: BookShardLink[], detail: BookShardLink[] | null): BookExportResponse {
  return {
    epoch,
    seq,
    builtAt: '2026-10-29T10:00:00.000Z',
    listings: 3,
    feeBps: 300,
    level: detail ? 'full' : 'minimal',
    prices,
    detail,
    expiresAt: '2026-10-29T10:15:00.000Z',
    stream: { path: '/market/stream', encodings: ['json', 'msgpack'] },
  };
}

function buildShards() {
  const p0 = shard('https://r2.test/p0', [[L1, ITEM_A, 'Ruby', '100.25', 1], [L2, ITEM_A, null, '9.90', 0]]);
  const p1 = shard('https://r2.test/p1', [[L3, ITEM_B, null, '3', 1]]);
  const d0 = shard('https://r2.test/d0', [[L1, { wear: 0.01, assetId: '44001' }]]);
  return {
    prices: [p0.link, p1.link],
    detail: [d0.link],
    fetch: fakeFetch({ [p0.link.url]: p0.body, [p1.link.url]: p1.body, [d0.link.url]: d0.body }),
  };
}

beforeEach(() => {
  FakeSocket.instances = [];
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
});

afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

describe('market.export', () => {
  it('returns the build with its etag and meta', async () => {
    const body = exportOf('100', 5, [], null);
    nock(BASE).get('/market/export').reply(200, { requestId: 'r1', success: true, data: body }, { etag: '"100-5-300-minimal"' });
    const sdk = new Skinshark({ apiKey: API_KEY, retries: false });

    const ex = await sdk.market.export();

    expect(ex?.epoch).toBe('100');
    expect(ex?.etag).toBe('"100-5-300-minimal"');
    expect(meta(ex)?.requestId).toBe('r1');
  });

  it('sends If-None-Match and answers null on 304', async () => {
    nock(BASE, { reqheaders: { 'if-none-match': '"100-5-300-minimal"' } }).get('/market/export').reply(304);
    const sdk = new Skinshark({ apiKey: API_KEY, retries: false });

    expect(await sdk.market.export({ ifNoneMatch: '"100-5-300-minimal"' })).toBeNull();
  });

  it('maps a refusal to its error key', async () => {
    nock(BASE)
      .get('/market/export')
      .reply(403, { requestId: 'r2', success: false, error: { code: 1, key: 'MARKET_DATA_NOT_ENABLED', message: 'no' } });
    const sdk = new Skinshark({ apiKey: API_KEY, retries: false });

    const err = await sdk.market.export().catch((e: unknown) => e);
    expect(isError(err, 'MARKET_DATA_NOT_ENABLED')).toBe(true);
  });
});

describe('loadBook', () => {
  it('downloads every shard and joins detail onto prices by id', async () => {
    const s = buildShards();
    const book = await loadBook(exportOf('100', 5, s.prices, s.detail), { fetch: s.fetch, concurrency: 2 });

    expect(book).toMatchObject({ epoch: '100', seq: 5, feeBps: 300, level: 'full' });
    expect(book.listings.size).toBe(3);
    expect(book.listings.get(L1)).toEqual({
      id: L1, itemId: ITEM_A, phase: 'Ruby', priceCents: 10025, instant: true, detail: { wear: 0.01, assetId: '44001' },
    });
    expect(book.listings.get(L2)).toEqual({ id: L2, itemId: ITEM_A, phase: null, priceCents: 990, instant: false });
    expect(book.listings.get(L3)?.priceCents).toBe(300);
  });

  it('keeps only the named items and skips detail when asked', async () => {
    const s = buildShards();
    const book = await loadBook(exportOf('100', 5, s.prices, s.detail), { fetch: s.fetch, items: [ITEM_A], detail: false });

    expect([...book.listings.keys()].sort()).toEqual([L1, L2]);
    expect(book.listings.get(L1)?.detail).toBeUndefined();
  });

  it('refuses a shard whose hash does not match', async () => {
    const s = buildShards();
    const tampered = s.prices.map((l, i) => (i === 0 ? { ...l, sha256: '0'.repeat(64) } : l));

    const err = await loadBook(exportOf('100', 5, tampered, null), { fetch: s.fetch }).catch((e: unknown) => e);
    expect(isError(err, 'SDK_BOOK_SHARD_INVALID')).toBe(true);
  });

  it('refuses a shard whose row count does not match', async () => {
    const s = buildShards();
    const short = s.prices.map((l, i) => (i === 1 ? { ...l, rows: 2 } : l));

    const err = await loadBook(exportOf('100', 5, short, null), { fetch: s.fetch }).catch((e: unknown) => e);
    expect(isError(err, 'SDK_BOOK_SHARD_INVALID')).toBe(true);
  });

  it('fails a lapsed link without retrying it', async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      return new Response('expired', { status: 403 });
    }) as typeof fetch;
    const link = { url: 'https://r2.test/x', rows: 1, bytes: 1, sha256: 'x' };

    const err = await loadBook(exportOf('100', 5, [link], null), { fetch: f }).catch((e: unknown) => e);
    expect(isError(err, 'SDK_NETWORK')).toBe(true);
    expect(calls).toBe(1);
  });
});

describe('market.stream', () => {
  it('resumes from the hello position, delivers frames in order and drops duplicates', async () => {
    mintTokens(1);
    const sdk = new Skinshark({ apiKey: API_KEY, retries: false });
    const frames: BookFrame[] = [];
    const stream = sdk.market.stream(
      { onFrame: (f) => frames.push(f) },
      { channels: ['prices'], encoding: 'json', WebSocket: Ctor, reconnect: fast },
    );
    const ws = await nextSocket(1);
    expect(ws.url).toBe('wss://stream.skinshark.gg/market/stream?encoding=json');
    expect(ws.protocols).toEqual(['bearer.tok-0']);
    expect(ws.binaryType).toBe('arraybuffer');

    ws.hello();
    expect(ws.sent).toEqual([{ op: 'subscribe', channels: ['prices'], epoch: '100', since: 5 }]);
    ws.json(frame('100', 6));
    ws.json(frame('100', 6));
    ws.json(frame('100', 9));

    expect(frames.map((f) => f.seq)).toEqual([6, 9]);
    expect(stream.position).toEqual({ epoch: '100', seq: 9 });
    stream.close();
  });

  it('reconnects on a gap and resumes from the last applied seq', async () => {
    mintTokens(2);
    const sdk = new Skinshark({ apiKey: API_KEY, retries: false });
    const errors: unknown[] = [];
    const stream = sdk.market.stream(
      { onFrame: () => {}, onError: (e) => errors.push(e) },
      { channels: ['prices', 'listings'], resume: { epoch: '100', seq: 20 }, WebSocket: Ctor, reconnect: fast },
    );
    const first = await nextSocket(1);
    first.hello();
    expect(first.sent[0]).toMatchObject({ epoch: '100', since: 20 });
    first.msgpack(frame('100', 21));
    first.msgpack(frame('100', 23));

    const second = await nextSocket(2);
    second.hello({ seq: 30 });
    expect(second.sent).toEqual([{ op: 'subscribe', channels: ['prices', 'listings'], epoch: '100', since: 21 }]);
    expect(errors).toHaveLength(1);
    stream.close();
  });

  it('resumes from its own position after a slow-consumer close, not the reason seq', async () => {
    mintTokens(2);
    const sdk = new Skinshark({ apiKey: API_KEY, retries: false });
    const errors: unknown[] = [];
    const stream = sdk.market.stream(
      { onFrame: () => {}, onError: (e) => errors.push(e) },
      { channels: ['prices'], items: [ITEM_A], WebSocket: Ctor, reconnect: fast },
    );
    const first = await nextSocket(1);
    first.hello();
    expect(first.sent[0]).toEqual({ op: 'subscribe', channels: ['prices'], items: [ITEM_A], epoch: '100', since: 5 });
    first.msgpack(frame('100', 7));
    first.close(4009, JSON.stringify({ key: 'SLOW_CONSUMER', epoch: '100', seq: 8 }));

    const second = await nextSocket(2);
    second.hello();
    expect(second.sent[0]).toMatchObject({ epoch: '100', since: 7 });
    expect(isError(errors[0], 'SLOW_CONSUMER')).toBe(true);
    stream.close();
  });

  it('reports a resync and continues in the new epoch', async () => {
    mintTokens(1);
    const sdk = new Skinshark({ apiKey: API_KEY, retries: false });
    const resyncs: unknown[] = [];
    const seqs: string[] = [];
    const stream = sdk.market.stream(
      { onFrame: (f) => seqs.push(`${f.epoch}:${f.seq}`), onResync: (at) => resyncs.push(at) },
      { channels: ['prices'], WebSocket: Ctor, reconnect: fast },
    );
    const ws = await nextSocket(1);
    ws.hello();
    ws.msgpack({ type: 'resync', epoch: '200', seq: 1 });
    ws.msgpack(frame('200', 2));
    ws.msgpack(frame('300', 4));

    expect(resyncs).toEqual([{ epoch: '200', seq: 1 }, { epoch: '300', seq: 3 }]);
    expect(seqs).toEqual(['200:2', '300:4']);
    stream.close();
  });

  it('surfaces server errors without closing and changes channels on the joined socket', async () => {
    mintTokens(1);
    const sdk = new Skinshark({ apiKey: API_KEY, retries: false });
    const errors: unknown[] = [];
    const stream = sdk.market.stream(
      { onFrame: () => {}, onError: (e, fatal) => errors.push([e, fatal]) },
      { channels: ['listings'], WebSocket: Ctor, reconnect: fast },
    );
    const ws = await nextSocket(1);
    stream.subscribe(['listings'], [ITEM_B]);
    expect(ws.sent).toEqual([]);
    ws.hello({ firehose: false });
    ws.json({ type: 'error', key: 'FIREHOSE_NOT_ENABLED', message: 'Name items' });
    stream.subscribe(['prices', 'listings'], [ITEM_A]);

    expect(ws.sent).toEqual([
      { op: 'subscribe', channels: ['listings'], items: [ITEM_B], epoch: '100', since: 5 },
      { op: 'subscribe', channels: ['prices', 'listings'], items: [ITEM_A] },
    ]);
    const [err, fatal] = errors[0] as [unknown, boolean];
    expect(isError(err, 'FIREHOSE_NOT_ENABLED')).toBe(true);
    expect(fatal).toBe(false);
    stream.close();
  });
});

describe('market.syncExport', () => {
  it('loads, follows the stream from the build, and reloads on resync after EXPORT_NOT_READY', async () => {
    const s = buildShards();
    const notReady = { requestId: 'n', success: false, error: { code: 1, key: 'EXPORT_NOT_READY', message: 'wait' } };
    nock(BASE)
      .get('/market/export').reply(200, { requestId: 'e1', success: true, data: exportOf('100', 5, s.prices, s.detail) })
      .get('/market/export').reply(503, notReady)
      .get('/market/export').reply(200, { requestId: 'e2', success: true, data: exportOf('200', 9, s.prices, null) });
    mintTokens(2);
    const sdk = new Skinshark({ apiKey: API_KEY, retries: false });
    const errors: unknown[] = [];
    let readies = 0;

    const book = sdk.market.syncExport(
      { onReady: () => readies++, onError: (e) => errors.push(e) },
      { fetch: s.fetch, WebSocket: Ctor, reconnect: fast, retry: fast },
    );
    await book.ready;
    expect(book.listings.size).toBe(3);

    const first = await nextSocket(1);
    first.hello();
    expect(first.sent[0]).toEqual({ op: 'subscribe', channels: ['listings'], epoch: '100', since: 5 });
    first.msgpack(
      frame('100', 6, {
        adds: [[Buffer.from(L1.replace(/-/g, ''), 'hex'), Buffer.from(ITEM_B, 'hex'), null, 777, false, null]],
        prices: [[L2, ITEM_A, 1000, true]],
        removes: [[L3, ITEM_B]],
      }),
    );
    expect(book.listings.get(L1)).toEqual({ id: L1, itemId: ITEM_B, phase: null, priceCents: 777, instant: false });
    expect(book.listings.get(L2)).toMatchObject({ priceCents: 1000, instant: true });
    expect(book.listings.has(L3)).toBe(false);
    expect(book.position).toEqual({ epoch: '100', seq: 6 });

    first.msgpack({ type: 'resync', epoch: '200', seq: 1 });
    const second = await nextSocket(2);
    second.hello({ epoch: '200', seq: 12 });
    expect(second.sent[0]).toEqual({ op: 'subscribe', channels: ['listings'], epoch: '200', since: 9 });
    expect(readies).toBe(2);
    expect(book.listings.size).toBe(3);
    expect(book.listings.get(L1)?.detail).toBeUndefined();
    expect(errors.some((e) => isError(e, 'EXPORT_NOT_READY'))).toBe(true);
    book.close();
  });

  it('stops and rejects ready when the merchant has no entitlement', async () => {
    nock(BASE)
      .get('/market/export')
      .reply(403, { requestId: 'x', success: false, error: { code: 1, key: 'MARKET_DATA_NOT_ENABLED', message: 'no' } });
    const sdk = new Skinshark({ apiKey: API_KEY, retries: false });
    const fatals: boolean[] = [];

    const book = sdk.market.syncExport({ onError: (_e, fatal) => fatals.push(fatal) }, { WebSocket: Ctor, retry: fast });

    const err = await book.ready.catch((e: unknown) => e);
    expect(isError(err, 'MARKET_DATA_NOT_ENABLED')).toBe(true);
    expect(fatals).toEqual([true]);
    expect(FakeSocket.instances).toHaveLength(0);
  });
});
