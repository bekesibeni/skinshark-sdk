import { SkinsharkError } from '../errors.js';
import type { HttpClient, RequestOptions } from '../internal/http.js';
import type {
  LiveListingRemoved,
  LiveListingState,
  LiveListingUpdated,
  LiveReady,
} from '../types/api.js';

/** A WebSocket constructor: Node's global one by default, or e.g. the `ws` package's. */
export type WebSocketConstructor = new (url: string, protocols?: string | string[]) => WebSocket;

export interface LiveOptions extends Pick<RequestOptions, 'onBehalfOf'> {
  /** Defaults to `globalThis.WebSocket` (Node 22+). Pass `ws` to get permessage-deflate. */
  WebSocket?: WebSocketConstructor;
  /** Reconnect backoff. Defaults: 500 ms doubling to 30 s. */
  reconnect?: { baseDelayMs?: number; maxDelayMs?: number };
}

interface LiveHandlers {
  onReady?: (info: LiveReady) => void;
  onRemoved?: (listings: LiveListingRemoved[]) => void;
  /** Connection, ticket and protocol failures. The socket keeps reconnecting unless `fatal`. */
  onError?: (err: SkinsharkError | Error, fatal: boolean) => void;
}

export interface MarketWatchHandlers extends LiveHandlers {
  /** The answer to every watch frame, including the re-sent set after a reconnect. */
  onState?: (listings: LiveListingState[]) => void;
  onUpdated?: (listings: LiveListingUpdated[]) => void;
}

export interface MarketRemovalsHandlers extends LiveHandlers {
  onRemoved: (listings: LiveListingRemoved[]) => void;
}

export interface LiveConnection {
  /** Stop for good: no reconnect follows. */
  close(): void;
}

export interface MarketWatch extends LiveConnection {
  /** Add ids. Their state arrives on `onState`; ids past the socket's limit raise `WATCH_LIMIT`. */
  watch(listingIds: readonly string[]): void;
  unwatch(listingIds: readonly string[]): void;
  /** Ids currently in the watch set. */
  readonly size: number;
}

// 500 listing ids is ~20 KB of JSON, well under the server's 32 KB frame cap.
const FRAME_IDS = 500;
// Closes that a reconnect cannot fix: the ticket lacks the scope, or we sent something invalid.
const FATAL_CLOSES = new Set([4002, 4003]);

interface Frame {
  event: string;
  data: unknown;
}

function chunks(ids: readonly string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += FRAME_IDS) out.push(ids.slice(i, i + FRAME_IDS));
  return out;
}

function liveUrl(http: HttpClient, scope: 'watch' | 'removals'): string {
  return `${http.baseUrl.replace(/^http/, 'ws')}/market/live?scope=${scope}`;
}

function openLive(
  http: HttpClient,
  scope: 'watch' | 'removals',
  handlers: LiveHandlers,
  opts: LiveOptions,
  hooks: { onOpen: (ws: WebSocket) => void; onFrame: (frame: Frame) => void },
): LiveConnection {
  const Ctor = opts.WebSocket ?? globalThis.WebSocket;
  if (!Ctor) throw new Error('No WebSocket implementation: use Node 22+ or pass opts.WebSocket');
  const baseDelay = opts.reconnect?.baseDelayMs ?? 500;
  const maxDelay = opts.reconnect?.maxDelayMs ?? 30_000;
  const tokenOpts: RequestOptions = opts.onBehalfOf ? { onBehalfOf: opts.onBehalfOf } : {};

  let closed = false;
  let attempt = 0;
  let socket: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = () => {
    if (closed) return;
    const delay = Math.min(maxDelay, baseDelay * 2 ** attempt) * (0.5 + Math.random() / 2);
    attempt += 1;
    timer = setTimeout(() => void connect(), delay);
  };

  const fail = (err: SkinsharkError | Error, fatal: boolean) => {
    handlers.onError?.(err, fatal);
    if (fatal) closed = true;
  };

  async function connect(): Promise<void> {
    timer = null;
    let token: string;
    try {
      // A ticket is single-use at connect time, so every attempt mints a fresh one.
      ({ token } = await http.request<{ token: string }>('POST', 'auth/ws-token', {
        opts: tokenOpts,
      }));
    } catch (err) {
      const e = err as SkinsharkError;
      fail(e, e.status === 401 || e.status === 403);
      schedule();
      return;
    }
    if (closed) return;

    const ws = new Ctor(liveUrl(http, scope), [`bearer.${token}`]);
    socket = ws;
    ws.onmessage = (ev: MessageEvent) => {
      let frame: Frame;
      try {
        frame = JSON.parse(String(ev.data)) as Frame;
      } catch {
        return;
      }
      if (frame.event === 'market.ready') {
        attempt = 0;
        handlers.onReady?.(frame.data as LiveReady);
        hooks.onOpen(ws);
        return;
      }
      if (frame.event === 'market.removed') {
        handlers.onRemoved?.((frame.data as { listings: LiveListingRemoved[] }).listings);
        return;
      }
      hooks.onFrame(frame);
    };
    ws.onclose = (ev: CloseEvent) => {
      if (socket === ws) socket = null;
      if (closed) return;
      if (FATAL_CLOSES.has(ev.code)) {
        fail(new Error(`Live socket closed: ${ev.code} ${ev.reason}`), true);
        return;
      }
      schedule();
    };
    ws.onerror = () => {
      // A close event always follows; reconnecting is decided there.
    };
  }

  void connect();
  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      socket?.close(1000);
      socket = null;
    },
  };
}

/**
 * Watch specific listings over `GET /market/live?scope=watch`. The watch set survives reconnects:
 * after each one the whole set is re-sent and `onState` reports what changed meanwhile.
 */
export function watchMarket(
  http: HttpClient,
  handlers: MarketWatchHandlers,
  opts: LiveOptions = {},
): MarketWatch {
  const ids = new Set<string>();
  let live: WebSocket | null = null;

  const send = (op: 'watch' | 'unwatch', list: readonly string[]) => {
    if (!live || live.readyState !== 1) return;
    for (const chunk of chunks(list)) live.send(JSON.stringify({ op, ids: chunk }));
  };

  const conn = openLive(http, 'watch', handlers, opts, {
    onOpen: (ws) => {
      live = ws;
      send('watch', [...ids]);
    },
    onFrame: (frame) => {
      switch (frame.event) {
        case 'market.state':
          handlers.onState?.((frame.data as { listings: LiveListingState[] }).listings);
          break;
        case 'market.updated':
          handlers.onUpdated?.((frame.data as { listings: LiveListingUpdated[] }).listings);
          break;
        case 'market.error': {
          const data = frame.data as { key: string; limit?: number };
          handlers.onError?.(
            new SkinsharkError({
              code: 0,
              key: data.key,
              message: `Watch limit of ${data.limit} ids reached`,
              meta: data,
            }),
            false,
          );
          break;
        }
      }
    },
  });

  return {
    watch(listingIds) {
      for (const id of listingIds) ids.add(id);
      // Already-watched ids are sent too: the server answers with their current state.
      send('watch', listingIds);
    },
    unwatch(listingIds) {
      const gone = listingIds.filter((id) => ids.delete(id));
      if (gone.length > 0) send('unwatch', gone);
    },
    get size() {
      return ids.size;
    },
    close() {
      live = null;
      conn.close();
    },
  };
}

/**
 * Every listing that leaves the market, batched every 250 ms, over
 * `GET /market/live?scope=removals`. Merchant only: a client bound with `as()` is refused.
 */
export function marketRemovals(
  http: HttpClient,
  handlers: MarketRemovalsHandlers,
  opts: LiveOptions = {},
): LiveConnection {
  return openLive(http, 'removals', handlers, opts, { onOpen: () => {}, onFrame: () => {} });
}
