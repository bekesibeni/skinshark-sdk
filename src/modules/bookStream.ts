import { unpack } from 'msgpackr';
import { SkinsharkError } from '../errors.js';
import type { HttpClient } from '../internal/http.js';
import type { BookChannel, BookHello, BookStreamEncoding } from '../types/api.js';
import {
  decodeBookFrame,
  judgeFrame,
  type BookFrame,
  type BookPosition,
  type WireBookFrame,
} from './bookCodec.js';
import type { WebSocketConstructor } from './live.js';

export const BOOK_STREAM_PATH = '/market/stream';
const CLOSE_SLOW_CONSUMER = 4009;

export interface BookStreamHandlers {
  onHello?: (hello: BookHello) => void;
  /** Every frame past the last applied position, in order. */
  onFrame: (frame: BookFrame) => void;
  /**
   * The server voided everything before `at` (a new epoch, or a resume it can no longer replay).
   * Drop the book, load a fresh export and resume from it. Frames after `at` keep arriving.
   */
  onResync?: (at: BookPosition) => void;
  /** Refusals, server errors and dropped connections. The stream keeps reconnecting unless `fatal`. */
  onError?: (err: SkinsharkError | Error, fatal: boolean) => void;
}

export interface BookStreamOptions {
  channels: BookChannel[];
  /** 16-hex item ids: `listings` for only these items. Without them `listings` needs the firehose. */
  items?: readonly string[];
  /** Defaults to msgpack: integer cents and binary ids, decoded to the same frames as json. */
  encoding?: BookStreamEncoding;
  /** Resume after this position, e.g. a loaded export's `{ epoch, seq }`. */
  resume?: BookPosition;
  /** Stream host, e.g. `wss://stream.skinshark.gg`. Defaults to the API host with `api.` → `stream.`. */
  url?: string;
  /** Defaults to `globalThis.WebSocket` (Node 22+). */
  WebSocket?: WebSocketConstructor;
  /** Reconnect backoff. Defaults: 500 ms doubling to 30 s. */
  reconnect?: { baseDelayMs?: number; maxDelayMs?: number };
}

export interface BookStream {
  /** Change channels or items on the live socket; kept for every reconnect. */
  subscribe(channels: BookChannel[], items?: readonly string[]): void;
  /** Stop for good: no reconnect follows. */
  close(): void;
  /** The last frame applied, where a reconnect resumes. */
  readonly position: BookPosition | null;
  readonly hello: BookHello | null;
}

interface ServerMessage {
  type: string;
  [k: string]: unknown;
}

export function bookStreamUrl(apiBaseUrl: string, encoding: BookStreamEncoding, url?: string): string {
  let u: URL;
  if (url) {
    u = new URL(url);
  } else {
    u = new URL(apiBaseUrl);
    if (u.hostname.startsWith('api.')) u.hostname = `stream.${u.hostname.slice(4)}`;
    u.pathname = '/';
  }
  if (u.protocol === 'https:') u.protocol = 'wss:';
  else if (u.protocol === 'http:') u.protocol = 'ws:';
  if (u.pathname === '/' || u.pathname === '') u.pathname = BOOK_STREAM_PATH;
  u.search = '';
  u.searchParams.set('encoding', encoding);
  return u.toString();
}

/** Text messages are JSON in both encodings; binary ones are msgpack. */
export function decodeStreamMessage(data: unknown): ServerMessage {
  if (typeof data === 'string') return JSON.parse(data) as ServerMessage;
  if (data instanceof ArrayBuffer) return unpack(Buffer.from(data)) as ServerMessage;
  if (ArrayBuffer.isView(data)) {
    return unpack(Buffer.from(data.buffer, data.byteOffset, data.byteLength)) as ServerMessage;
  }
  throw new Error('Unsupported stream message type');
}

export function openBookStream(
  http: HttpClient,
  handlers: BookStreamHandlers,
  opts: BookStreamOptions,
): BookStream {
  const Ctor = opts.WebSocket ?? globalThis.WebSocket;
  if (!Ctor) throw new Error('No WebSocket implementation: use Node 22+ or pass opts.WebSocket');
  const baseDelay = opts.reconnect?.baseDelayMs ?? 500;
  const maxDelay = opts.reconnect?.maxDelayMs ?? 30_000;
  const url = bookStreamUrl(http.baseUrl, opts.encoding ?? 'msgpack', opts.url);

  let channels = [...opts.channels];
  let items = opts.items ? [...opts.items] : [];
  let position: BookPosition | null = opts.resume ? { ...opts.resume } : null;
  let hello: BookHello | null = null;
  let contiguous = false;
  let closed = false;
  let attempt = 0;
  let socket: WebSocket | null = null;
  // The socket whose first subscribe went out; only then may a later one change channels.
  let joined: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // Only book plus the whole firehose sees every frame; any filter lets seq jump.
  const sync = () => {
    contiguous =
      channels.includes('prices') &&
      channels.includes('listings') &&
      items.length === 0 &&
      hello?.firehose === true;
  };

  const schedule = (now = false) => {
    if (closed || timer) return;
    const delay = now ? 0 : Math.min(maxDelay, baseDelay * 2 ** attempt) * (0.5 + Math.random() / 2);
    attempt += 1;
    timer = setTimeout(() => void connect(), delay);
  };

  const fail = (err: SkinsharkError | Error, fatal: boolean) => {
    handlers.onError?.(err, fatal);
    if (fatal) closed = true;
  };

  // Drops the socket without its close event scheduling a second reconnect.
  const drop = () => {
    const ws = socket;
    socket = null;
    ws?.close(1000);
  };

  const subscribeMessage = (join: boolean): string => {
    const msg: Record<string, unknown> = { op: 'subscribe', channels };
    if (items.length > 0) msg.items = items;
    if (join && position) {
      msg.epoch = position.epoch;
      msg.since = position.seq;
    }
    return JSON.stringify(msg);
  };

  const onFrame = (wire: WireBookFrame) => {
    const frame = decodeBookFrame(wire);
    const verdict = judgeFrame(position, frame, contiguous);
    if (verdict === 'duplicate') return;
    if (verdict === 'gap') {
      fail(new Error(`Book stream gap: frame ${frame.seq} after ${position?.seq}`), false);
      drop();
      schedule(true);
      return;
    }
    if (verdict === 'epoch') {
      position = { epoch: frame.epoch, seq: frame.seq - 1 };
      handlers.onResync?.(position);
      if (closed) return;
    }
    position = { epoch: frame.epoch, seq: frame.seq };
    handlers.onFrame(frame);
  };

  async function connect(): Promise<void> {
    timer = null;
    let token: string;
    try {
      // A ticket is single-use at connect time, so every attempt mints a fresh one.
      ({ token } = await http.request<{ token: string }>('POST', 'auth/ws-token'));
    } catch (err) {
      const e = err as SkinsharkError;
      fail(e, e.status === 401 || e.status === 403);
      schedule();
      return;
    }
    if (closed) return;

    const ws = new Ctor(url, [`bearer.${token}`]);
    ws.binaryType = 'arraybuffer';
    socket = ws;
    let greeted = false;

    ws.onmessage = (ev: MessageEvent) => {
      if (socket !== ws) return;
      let msg: ServerMessage;
      try {
        msg = decodeStreamMessage(ev.data);
      } catch {
        return;
      }
      switch (msg.type) {
        case 'hello': {
          greeted = true;
          attempt = 0;
          hello = msg as unknown as BookHello;
          sync();
          // Without a position, resume from the hello's: frames cut before the subscribe lands
          // are replayed instead of silently skipped.
          if (!position && hello.epoch !== null) position = { epoch: hello.epoch, seq: hello.seq };
          ws.send(subscribeMessage(true));
          joined = ws;
          handlers.onHello?.(hello);
          break;
        }
        case 'frame':
          onFrame(msg as unknown as WireBookFrame);
          break;
        case 'resync':
          position = { epoch: String(msg.epoch), seq: Number(msg.seq) };
          handlers.onResync?.(position);
          break;
        case 'error':
          fail(
            new SkinsharkError({ code: 0, key: String(msg.key), message: String(msg.message) }),
            false,
          );
          break;
      }
    };
    ws.onclose = (ev: CloseEvent) => {
      if (socket !== ws) return;
      socket = null;
      if (closed) return;
      if (ev.code === CLOSE_SLOW_CONSUMER) {
        // Resume from what was applied, not the reason's seq: the frame that tripped the close
        // is counted there but was never sent.
        let meta: Record<string, unknown> | undefined;
        try {
          meta = JSON.parse(ev.reason) as Record<string, unknown>;
        } catch {
          meta = undefined;
        }
        fail(
          new SkinsharkError({
            code: 0,
            key: 'SLOW_CONSUMER',
            message: 'Book stream fell behind; resuming',
            meta,
          }),
          false,
        );
        schedule(true);
        return;
      }
      if (!greeted) {
        // A refused upgrade (no entitlement, socket cap) surfaces as a bare close.
        fail(new Error(`Book stream closed before hello: ${ev.code} ${ev.reason}`), false);
      }
      schedule();
    };
    ws.onerror = () => {
      // A close event always follows; reconnecting is decided there.
    };
  }

  void connect();
  return {
    subscribe(next, nextItems) {
      channels = [...next];
      items = nextItems ? [...nextItems] : [];
      sync();
      if (socket && joined === socket && socket.readyState === 1) socket.send(subscribeMessage(false));
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      drop();
    },
    get position() {
      return position;
    },
    get hello() {
      return hello;
    },
  };
}
