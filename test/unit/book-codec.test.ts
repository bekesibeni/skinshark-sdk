import { describe, expect, it } from 'vitest';
import { Packr } from 'msgpackr';
import {
  applyBookFrame,
  decimalToCents,
  decodeBookFrame,
  eachLine,
  itemIdOf,
  judgeFrame,
  listingIdOf,
  parseExportLine,
  type BookListing,
  type WireBookFrame,
} from '../../src/modules/bookCodec.js';
import { bookStreamUrl, decodeStreamMessage } from '../../src/modules/bookStream.js';

const LISTING = '0199aaaa-bbbb-7ccc-8ddd-eeeeffff0001';
const ITEM = '00a1b2c3d4e5f607';
const packr = new Packr({ useRecords: false });

function hexBytes(hex: string): Buffer {
  return Buffer.from(hex.replace(/-/g, ''), 'hex');
}

const jsonFrame = {
  type: 'frame',
  epoch: '1761750000000',
  seq: 42,
  t: 1761750001000,
  adds: [[LISTING, ITEM, 'Phase 2', '12.34', 1, { wear: 0.12, seed: 661 }]],
  prices: [[LISTING, ITEM, '12.30', 0]],
  removes: [['plain-id', 'not-hex-item']],
  tops: [[ITEM, null, '12.30', null, 3, 0]],
};

const msgpackFrame = {
  ...jsonFrame,
  adds: [[hexBytes(LISTING), hexBytes(ITEM), 'Phase 2', 1234, true, { wear: 0.12, seed: 661 }]],
  prices: [[hexBytes(LISTING), hexBytes(ITEM), 1230, false]],
  removes: [['plain-id', 'not-hex-item']],
  tops: [[hexBytes(ITEM), null, 1230, null, 3, 0]],
};

describe('decimalToCents', () => {
  it('parses every decimal spelling into exact integer cents', () => {
    expect(decimalToCents('12.34')).toBe(1234);
    expect(decimalToCents('12.3')).toBe(1230);
    expect(decimalToCents('12')).toBe(1200);
    expect(decimalToCents('0.07')).toBe(7);
    expect(decimalToCents('1.')).toBe(100);
    expect(decimalToCents('19999.99')).toBe(1999999);
    expect(decimalToCents('0.29')).toBe(29);
  });
});

describe('ids', () => {
  it('formats 16 raw bytes as a lowercase uuid and 8 as 16-hex, keeping strings as sent', () => {
    expect(listingIdOf(hexBytes(LISTING))).toBe(LISTING);
    expect(itemIdOf(hexBytes(ITEM))).toBe(ITEM);
    expect(listingIdOf('plain-id')).toBe('plain-id');
    expect(itemIdOf('not-hex-item')).toBe('not-hex-item');
  });
});

describe('decodeBookFrame', () => {
  it('decodes json and msgpack frames to the same shape', () => {
    const fromJson = decodeBookFrame(decodeStreamMessage(JSON.stringify(jsonFrame)) as unknown as WireBookFrame);
    const packed = packr.pack(msgpackFrame);
    const ab = packed.buffer.slice(packed.byteOffset, packed.byteOffset + packed.byteLength);
    const fromMsgpack = decodeBookFrame(decodeStreamMessage(ab) as unknown as WireBookFrame);

    expect(fromMsgpack).toEqual(fromJson);
    expect(fromJson).toEqual({
      epoch: '1761750000000',
      seq: 42,
      t: 1761750001000,
      adds: [
        {
          id: LISTING,
          itemId: ITEM,
          phase: 'Phase 2',
          priceCents: 1234,
          instant: true,
          detail: { wear: 0.12, seed: 661 },
        },
      ],
      prices: [{ id: LISTING, itemId: ITEM, priceCents: 1230, instant: false }],
      removes: [{ id: 'plain-id', itemId: 'not-hex-item' }],
      tops: [
        {
          itemId: ITEM,
          phase: null,
          bestCents: 1230,
          bestInstantCents: null,
          listings: 3,
          instantListings: 0,
        },
      ],
    });
  });

  it('leaves detail off an add the level gives none', () => {
    const frame = decodeBookFrame({
      ...jsonFrame,
      adds: [[LISTING, ITEM, null, '1.00', 0, null]],
    } as WireBookFrame);
    expect(frame.adds[0]).toEqual({ id: LISTING, itemId: ITEM, phase: null, priceCents: 100, instant: false });
  });

  it('decodes a msgpack Uint8Array view as well as an ArrayBuffer', () => {
    const packed = packr.pack({ type: 'hello', epoch: null, seq: 0 });
    expect(decodeStreamMessage(new Uint8Array(packed))).toEqual({ type: 'hello', epoch: null, seq: 0 });
  });
});

describe('shard lines', () => {
  it('reads a line as a listing, with what is left over as its detail', () => {
    const line = { id: LISTING, itemId: ITEM, name: 'Knife', phase: null, price: '5.42', instant: true };
    expect(parseExportLine(JSON.stringify(line))).toEqual({
      id: LISTING,
      itemId: ITEM,
      name: 'Knife',
      phase: null,
      priceCents: 542,
      instant: true,
    });
    expect(parseExportLine(JSON.stringify({ ...line, stickers: ['a'], assetId: '44001' })).detail).toEqual({
      stickers: ['a'],
      assetId: '44001',
    });
  });

  it('splits lines across chunk boundaries, multi-byte characters included, and skips blanks', async () => {
    const text = '["a","é"]\n\n["b","ü"]\n["c"]';
    const bytes = Buffer.from(text, 'utf8');
    async function* chunks() {
      for (let i = 0; i < bytes.length; i += 3) yield bytes.subarray(i, i + 3);
    }
    const lines: string[] = [];
    await eachLine(chunks(), (l) => lines.push(l));
    expect(lines).toEqual(['["a","é"]', '["b","ü"]', '["c"]']);
  });
});

describe('judgeFrame', () => {
  const at = { epoch: '100', seq: 10 };

  it('applies the first frame with no position', () => {
    expect(judgeFrame(null, { epoch: '100', seq: 7 }, true)).toBe('apply');
  });

  it('drops a frame at or before the position', () => {
    expect(judgeFrame(at, { epoch: '100', seq: 10 }, true)).toBe('duplicate');
    expect(judgeFrame(at, { epoch: '100', seq: 3 }, false)).toBe('duplicate');
  });

  it('flags a jump only when the subscription sees every frame', () => {
    expect(judgeFrame(at, { epoch: '100', seq: 12 }, true)).toBe('gap');
    expect(judgeFrame(at, { epoch: '100', seq: 12 }, false)).toBe('apply');
    expect(judgeFrame(at, { epoch: '100', seq: 11 }, true)).toBe('apply');
  });

  it('treats a frame from another epoch as a resync', () => {
    expect(judgeFrame(at, { epoch: '200', seq: 1 }, false)).toBe('epoch');
  });
});

describe('applyBookFrame', () => {
  it('adds, reprices and removes listings, ignoring prices for unknown ids', () => {
    const listings = new Map<string, BookListing>([
      ['a', { id: 'a', itemId: ITEM, phase: null, priceCents: 500, instant: false }],
      ['b', { id: 'b', itemId: ITEM, phase: null, priceCents: 600, instant: true }],
    ]);
    applyBookFrame(listings, {
      epoch: '1',
      seq: 2,
      t: 0,
      adds: [{ id: 'c', itemId: ITEM, phase: null, priceCents: 700, instant: true }],
      prices: [
        { id: 'a', itemId: ITEM, priceCents: 450, instant: true },
        { id: 'zz', itemId: ITEM, priceCents: 1, instant: true },
      ],
      removes: [{ id: 'b', itemId: ITEM }],
      tops: [],
    });
    expect([...listings.keys()].sort()).toEqual(['a', 'c']);
    expect(listings.get('a')).toMatchObject({ priceCents: 450, instant: true });
    expect(listings.has('zz')).toBe(false);
  });
});

describe('bookStreamUrl', () => {
  it('derives the stream host from the api host, or takes an explicit one', () => {
    expect(bookStreamUrl('https://api.skinshark.gg', 'msgpack')).toBe(
      'wss://stream.skinshark.gg/market/stream?encoding=msgpack',
    );
    expect(bookStreamUrl('http://localhost:3000', 'json', 'http://localhost:3100')).toBe(
      'ws://localhost:3100/market/stream?encoding=json',
    );
    expect(bookStreamUrl('https://api.skinshark.gg', 'json', 'wss://edge.example/custom/path')).toBe(
      'wss://edge.example/custom/path?encoding=json',
    );
  });
});
