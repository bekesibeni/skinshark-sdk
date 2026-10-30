import type { BookDetail } from '../types/api.js';

/** One listing of the partner book, price fee-inclusive in integer USD cents. */
export interface BookListing {
  id: string;
  /** 16-hex catalog item id. */
  itemId: string;
  /** The skin's market name. Only a build carries it, so a listing added by a frame has none. */
  name?: string;
  phase: string | null;
  priceCents: number;
  instant: boolean;
  /** Absent when no detail field applies to the listing. */
  detail?: BookDetail;
}

export interface BookPriceChange {
  id: string;
  itemId: string;
  priceCents: number;
  instant: boolean;
}

export interface BookRemoval {
  id: string;
  itemId: string;
}

/** Top of book for one item (and phase): the cheapest listing overall and the cheapest instant one. */
export interface BookTop {
  itemId: string;
  phase: string | null;
  bestCents: number | null;
  bestInstantCents: number | null;
  listings: number;
  instantListings: number;
}

/** One stream frame, decoded to the same shape from either encoding. */
export interface BookFrame {
  epoch: string;
  seq: number;
  /** Unix ms the frame was cut. */
  t: number;
  adds: BookListing[];
  prices: BookPriceChange[];
  removes: BookRemoval[];
  tops: BookTop[];
}

/** The last frame a consumer applied; the stream resumes after it. */
export interface BookPosition {
  epoch: string;
  seq: number;
}

/** How a frame relates to the last applied position. */
export type FrameVerdict = 'apply' | 'duplicate' | 'gap' | 'epoch';

type WireId = string | Uint8Array;
type WirePrice = string | number;
type WireFlag = 0 | 1 | boolean;

/** A frame as it arrives: json and msgpack differ only in how ids, prices and flags are spelled. */
export interface WireBookFrame {
  type: 'frame';
  epoch: string;
  seq: number;
  t: number;
  adds: [WireId, WireId, string | null, WirePrice, WireFlag, BookDetail | null][];
  prices: [WireId, WireId, WirePrice, WireFlag][];
  removes: [WireId, WireId][];
  tops: [WireId, string | null, WirePrice | null, WirePrice | null, number, number][];
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

function hexOf(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i] as number];
  return s;
}

/** A msgpack listing id is its 16 UUID bytes; anything else is already the id. */
export function listingIdOf(v: WireId): string {
  if (typeof v === 'string') return v;
  const h = hexOf(v);
  if (v.length !== 16) return h;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A msgpack item id is its 8 raw bytes; a string one is kept as sent. */
export function itemIdOf(v: WireId): string {
  return typeof v === 'string' ? v : hexOf(v);
}

/** Parses a decimal USD string ("12.34", "12.3", "12") into integer cents, without floats. */
export function decimalToCents(s: string): number {
  const dot = s.indexOf('.');
  if (dot === -1) return Number(s) * 100;
  const frac = s.slice(dot + 1, dot + 3);
  return Number(s.slice(0, dot)) * 100 + Number(frac.length === 1 ? `${frac}0` : frac || '0');
}

// json carries the decimal string, msgpack integer cents already.
function centsOf(v: WirePrice): number {
  return typeof v === 'number' ? v : decimalToCents(v);
}

function flagOf(v: WireFlag): boolean {
  return v === true || v === 1;
}

export function decodeBookFrame(wire: WireBookFrame): BookFrame {
  const adds: BookListing[] = new Array(wire.adds.length);
  for (let i = 0; i < wire.adds.length; i++) {
    const [id, itemId, phase, price, instant, detail] = wire.adds[i]!;
    const l: BookListing = {
      id: listingIdOf(id),
      itemId: itemIdOf(itemId),
      phase,
      priceCents: centsOf(price),
      instant: flagOf(instant),
    };
    if (detail) l.detail = detail;
    adds[i] = l;
  }
  return {
    epoch: wire.epoch,
    seq: wire.seq,
    t: wire.t,
    adds,
    prices: wire.prices.map(([id, itemId, price, instant]) => ({
      id: listingIdOf(id),
      itemId: itemIdOf(itemId),
      priceCents: centsOf(price),
      instant: flagOf(instant),
    })),
    removes: wire.removes.map(([id, itemId]) => ({ id: listingIdOf(id), itemId: itemIdOf(itemId) })),
    tops: wire.tops.map(([itemId, phase, best, bestInstant, listings, instantListings]) => ({
      itemId: itemIdOf(itemId),
      phase,
      bestCents: best === null ? null : centsOf(best),
      bestInstantCents: bestInstant === null ? null : centsOf(bestInstant),
      listings,
      instantListings,
    })),
  };
}

/** One line of a build's shard: a whole listing as a named object. */
export function parseExportLine(line: string): BookListing {
  const { id, itemId, name, phase, price, instant, ...detail } = JSON.parse(line) as {
    id: string;
    itemId: string;
    name: string | null;
    phase: string | null;
    price: string;
    instant: boolean;
  } & BookDetail;
  const l: BookListing = { id, itemId, phase, priceCents: decimalToCents(price), instant };
  if (name) l.name = name;
  if (Object.keys(detail).length > 0) l.detail = detail;
  return l;
}

/**
 * Where a frame stands against the last applied position. `contiguous` is only true when the
 * subscription sees every frame (book plus the whole listings firehose): the server skips frames
 * with nothing for a connection, so a filtered subscription legitimately jumps seq.
 */
export function judgeFrame(
  at: BookPosition | null,
  frame: BookPosition,
  contiguous: boolean,
): FrameVerdict {
  if (!at) return 'apply';
  if (frame.epoch !== at.epoch) return 'epoch';
  if (frame.seq <= at.seq) return 'duplicate';
  if (contiguous && frame.seq !== at.seq + 1) return 'gap';
  return 'apply';
}

/** Applies a frame's listing changes to a book loaded with `loadBook`. Tops are not listings. */
export function applyBookFrame(listings: Map<string, BookListing>, frame: BookFrame): void {
  for (const a of frame.adds) listings.set(a.id, a);
  for (const p of frame.prices) {
    const l = listings.get(p.id);
    if (!l) continue;
    l.priceCents = p.priceCents;
    l.instant = p.instant;
  }
  for (const r of frame.removes) listings.delete(r.id);
}

/** Calls `onLine` for every non-empty line of a byte stream, split on `\n`. */
export async function eachLine(
  source: AsyncIterable<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  let rest: Buffer | null = null;
  for await (const chunk of source) {
    const piece = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    const buf: Buffer = rest ? Buffer.concat([rest, piece]) : piece;
    let start = 0;
    let nl: number;
    while ((nl = buf.indexOf(10, start)) !== -1) {
      if (nl > start) onLine(buf.toString('utf8', start, nl));
      start = nl + 1;
    }
    rest = start < buf.length ? buf.subarray(start) : null;
  }
  if (rest && rest.length > 0) onLine(rest.toString('utf8'));
}
