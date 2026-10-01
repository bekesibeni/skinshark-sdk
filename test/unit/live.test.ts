import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nock from 'nock';
import { Skinshark, type WebSocketConstructor } from '../../src/index.js';

const BASE = 'https://api.skinshark.gg';
const API_KEY = 'sk_test_abcdef';

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: { op: string; ids: string[] }[] = [];
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string, readonly protocols: string[]) {
    FakeSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(JSON.parse(data) as { op: string; ids: string[] });
  }

  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }

  ready(scope: string, limit?: number) {
    this.readyState = 1;
    this.emit('market.ready', limit === undefined ? { scope } : { scope, limit });
  }

  emit(event: string, data: unknown) {
    this.onmessage?.({ data: JSON.stringify({ event, data, ts: Date.now() }) });
  }
}

const Ctor = FakeSocket as unknown as WebSocketConstructor;

function mintTokens(n: number) {
  const scope = nock(BASE);
  for (let i = 0; i < n; i++) {
    scope.post('/auth/ws-token').reply(200, { requestId: `req-w${i}`, success: true, data: { token: `tok-${i}`, expiresIn: '5m' } });
  }
}

async function nextSocket(count: number): Promise<FakeSocket> {
  await vi.waitFor(() => expect(FakeSocket.instances.length).toBe(count));
  return FakeSocket.instances[count - 1] as FakeSocket;
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

describe('market.watch', () => {
  it('re-sends the whole watch set after a reconnect and surfaces the fresh state', async () => {
    mintTokens(2);
    const sdk = new Skinshark({ apiKey: API_KEY, retries: false });
    const states: unknown[] = [];
    const watch = sdk.market.watch(
      { onState: (l) => states.push(...l) },
      { WebSocket: Ctor, reconnect: { baseDelayMs: 1, maxDelayMs: 2 } },
    );
    const first = await nextSocket(1);
    first.ready('watch', 500);
    watch.watch(['a', 'b']);
    watch.unwatch(['b']);
    first.close(1006);

    const second = await nextSocket(2);
    expect(second.protocols).toEqual(['bearer.tok-1']);
    second.ready('watch', 500);
    expect(second.sent).toEqual([{ op: 'watch', ids: ['a'] }]);
    second.emit('market.state', { listings: [{ listingId: 'a', alive: false }] });
    expect(states).toEqual([{ listingId: 'a', alive: false }]);
    watch.close();
  });
});
