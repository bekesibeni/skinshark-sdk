import { createHash } from 'node:crypto';
import { createGunzip } from 'node:zlib';
import { SkinsharkError } from '../errors.js';
import {
  attachMeta,
  makeResponseMeta,
  type HttpClient,
  type RequestOptions,
} from '../internal/http.js';
import type {
  BookChannel,
  BookDataLevel,
  BookExportResponse,
  BookShardLink,
  Envelope,
} from '../types/api.js';
import type { ErrorKey } from '../types/errors.js';
import {
  applyBookFrame,
  eachLine,
  parseExportLine,
  type BookFrame,
  type BookListing,
  type BookPosition,
} from './bookCodec.js';
import {
  openBookStream,
  type BookStream,
  type BookStreamHandlers,
  type BookStreamOptions,
} from './bookStream.js';

export interface BookExportOptions extends RequestOptions {
  /** A previous export's `etag`: an unchanged build answers `null` instead of a body. */
  ifNoneMatch?: string;
}

export interface BookExport extends BookExportResponse {
  /** Pass back as `ifNoneMatch`. It changes with the build, the fee tier and the level. */
  etag: string | null;
}

export interface LoadBookOptions {
  /** Keep only these item ids. Every row is still counted against the shard's `rows`. */
  items?: Iterable<string>;
  /** Shards downloaded at once. Defaults to 4. */
  concurrency?: number;
  signal?: AbortSignal;
  /** Defaults to the global `fetch`. Shard links are pre-signed, so no api-key is sent. */
  fetch?: typeof fetch;
}

export interface LoadedBook extends BookPosition {
  feeBps: number;
  level: BookDataLevel;
  listings: Map<string, BookListing>;
}

export interface SyncBookHandlers {
  /** After every (re)load, once the stream resumes from it. `book.listings` is a new Map each time. */
  onReady?: (book: SyncedBook) => void;
  /** After the frame was applied to `book.listings`. */
  onFrame?: (frame: BookFrame, book: SyncedBook) => void;
  /** The stream voided the book; a reload has started and frames pause until it lands. */
  onResync?: (at: BookPosition) => void;
  /** Export, download and stream failures. Only an entitlement refusal (401/403) is fatal. */
  onError?: (err: SkinsharkError | Error, fatal: boolean) => void;
}

export interface SyncBookOptions
  extends Omit<BookStreamOptions, 'channels' | 'resume'>,
    Omit<LoadBookOptions, 'items'> {
  /** Defaults to `['listings']`. Add `book` to receive tops on `onFrame` too. */
  channels?: BookChannel[];
  /** Load and follow only these items; omitted, the whole book (needs the firehose). */
  items?: readonly string[];
  /** Backoff between failed export/load attempts. Defaults: 1 s doubling to 60 s. */
  retry?: { baseDelayMs?: number; maxDelayMs?: number };
}

export interface SyncedBook {
  readonly listings: Map<string, BookListing>;
  /** The last frame applied, or the loaded build's position. Null before the first load. */
  readonly position: BookPosition | null;
  /** Settles after the first load: rejects only on a fatal error before it. */
  readonly ready: Promise<void>;
  close(): void;
}

const DEFAULT_CONCURRENCY = 4;
const DOWNLOAD_ATTEMPTS = 3;

function shardError(link: BookShardLink, message: string): SkinsharkError {
  return new SkinsharkError({
    code: 0,
    key: 'SDK_BOOK_SHARD_INVALID',
    message,
    meta: { rows: link.rows, bytes: link.bytes, sha256: link.sha256 },
  });
}

async function download(
  link: BookShardLink,
  f: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await f(link.url, signal ? { signal } : {});
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = err;
      continue;
    }
    if (res.ok) {
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length !== link.bytes) {
        throw shardError(link, `Book shard is ${body.length} bytes, expected ${link.bytes}`);
      }
      if (createHash('sha256').update(body).digest('hex') !== link.sha256.toLowerCase()) {
        throw shardError(link, 'Book shard failed its sha256 check');
      }
      return body;
    }
    lastErr = new SkinsharkError({
      code: 0,
      key: 'SDK_NETWORK',
      message: `Book shard download failed: HTTP ${res.status}`,
      status: res.status,
    });
    // A lapsed link (403) or a missing object does not heal on retry; a new export does.
    if (res.status < 500) break;
  }
  if (lastErr instanceof SkinsharkError) throw lastErr;
  throw new SkinsharkError({
    code: 0,
    key: 'SDK_NETWORK',
    message: 'Book shard download failed',
    cause: lastErr,
  });
}

async function eachShardLine(
  link: BookShardLink,
  gz: Buffer,
  onLine: (line: string) => void,
): Promise<void> {
  const gunzip = createGunzip();
  gunzip.end(gz);
  let rows = 0;
  await eachLine(gunzip, (line) => {
    rows++;
    onLine(line);
  });
  if (rows !== link.rows) throw shardError(link, `Book shard has ${rows} rows, expected ${link.rows}`);
}

async function eachLimit<T>(
  list: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < list.length) await fn(list[next++] as T);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, worker));
}

/**
 * Downloads an export's shards and checks each one's bytes, sha256 and row count. Resume the
 * stream from the returned `{ epoch, seq }`.
 */
export async function loadBook(exp: BookExportResponse, opts: LoadBookOptions = {}): Promise<LoadedBook> {
  const f = opts.fetch ?? globalThis.fetch;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const keep = opts.items ? new Set(opts.items) : null;
  const listings = new Map<string, BookListing>();

  await eachLimit(exp.files, concurrency, async (link) => {
    const gz = await download(link, f, opts.signal);
    await eachShardLine(link, gz, (line) => {
      const l = parseExportLine(line);
      if (!keep || keep.has(l.itemId)) listings.set(l.id, l);
    });
  });

  return { epoch: exp.epoch, seq: exp.seq, feeBps: exp.feeBps, level: exp.level, listings };
}

/** GET /market/export, honouring `ifNoneMatch`: a 304 answers null. */
export async function exportBook(
  http: HttpClient,
  opts: BookExportOptions = {},
): Promise<BookExport | null> {
  const { ifNoneMatch, ...reqOpts } = opts;
  if (ifNoneMatch) reqOpts.headers = { ...reqOpts.headers, 'if-none-match': ifNoneMatch };
  const res = await http.fetchRaw<string>('GET', 'market/export', {
    acceptStatus: [304],
    opts: reqOpts,
  });
  if (res.status === 304) return null;
  let env: Envelope<BookExportResponse> | undefined;
  try {
    env = JSON.parse(res.body) as Envelope<BookExportResponse>;
  } catch {
    env = undefined;
  }
  if (!env || env.success !== true || !env.data) {
    throw new SkinsharkError({
      code: env?.error?.code ?? 0,
      key: (env?.error?.key as ErrorKey | undefined) ?? 'SDK_INVALID_RESPONSE',
      message: env?.error?.message ?? 'Server returned an unsuccessful envelope',
      status: res.status,
      requestId: env?.requestId,
    });
  }
  const out: BookExport = { ...env.data, etag: res.headers.etag ?? null };
  return attachMeta(out, makeResponseMeta(env.requestId, res.status, res.headers));
}

/**
 * Keeps a full-depth copy of the partner book: export, load, then the stream from the build's
 * position. A resync reloads (retrying `EXPORT_NOT_READY` while the new epoch's build lands) and
 * resumes from the new build.
 */
export function syncBook(
  http: HttpClient,
  handlers: SyncBookHandlers,
  opts: SyncBookOptions = {},
): SyncedBook {
  const { channels = ['listings'], items, retry, concurrency, signal, fetch: f, ...rest } = opts;
  const baseDelay = retry?.baseDelayMs ?? 1_000;
  const maxDelay = retry?.maxDelayMs ?? 60_000;
  const loadOpts: LoadBookOptions = {};
  if (concurrency !== undefined) loadOpts.concurrency = concurrency;
  if (signal !== undefined) loadOpts.signal = signal;
  if (f !== undefined) loadOpts.fetch = f;
  if (items && items.length > 0) loadOpts.items = items;

  let listings = new Map<string, BookListing>();
  let loadedAt: BookPosition | null = null;
  let stream: BookStream | null = null;
  let closed = false;
  let loads = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const { promise: ready, resolve, reject } = Promise.withResolvers<void>();
  // Marks the rejection handled for a caller who never awaits `ready`.
  ready.catch(() => {});

  const sleep = (ms: number) =>
    new Promise<void>((done) => {
      timer = setTimeout(() => {
        timer = null;
        done();
      }, ms);
    });

  const synced: SyncedBook = {
    get listings() {
      return listings;
    },
    get position() {
      return stream?.position ?? loadedAt;
    },
    ready,
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      stream?.close();
      stream = null;
    },
  };

  const streamHandlers: BookStreamHandlers = {
    onFrame: (frame) => {
      applyBookFrame(listings, frame);
      handlers.onFrame?.(frame, synced);
    },
    onResync: (at) => {
      stream?.close();
      stream = null;
      handlers.onResync?.(at);
      void load();
    },
    onError: (err, fatal) => {
      handlers.onError?.(err, fatal);
      if (fatal) synced.close();
    },
  };

  async function load(): Promise<void> {
    const run = ++loads;
    let attempt = 0;
    while (!closed && run === loads) {
      try {
        const exp = await exportBook(http);
        if (!exp) throw new Error('Book export answered 304 without a conditional request');
        const loaded = await loadBook(exp, loadOpts);
        if (closed || run !== loads) return;
        listings = loaded.listings;
        loadedAt = { epoch: loaded.epoch, seq: loaded.seq };
        const streamOpts: BookStreamOptions = { ...rest, channels, resume: loadedAt };
        if (items && items.length > 0) streamOpts.items = items;
        stream = openBookStream(http, streamHandlers, streamOpts);
        handlers.onReady?.(synced);
        resolve();
        return;
      } catch (err) {
        const e = err as SkinsharkError | Error;
        // A lapsed shard link is a 403 from storage (SDK_NETWORK), which a fresh export fixes.
        const fatal =
          e instanceof SkinsharkError &&
          e.key !== 'SDK_NETWORK' &&
          (e.status === 401 || e.status === 403);
        handlers.onError?.(e, fatal);
        if (fatal) {
          closed = true;
          reject(e);
          return;
        }
        await sleep(Math.min(maxDelay, baseDelay * 2 ** attempt++) * (0.5 + Math.random() / 2));
      }
    }
  }

  void load();
  return synced;
}
