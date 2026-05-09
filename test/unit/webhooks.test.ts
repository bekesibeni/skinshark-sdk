import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyWebhook, isError } from '../../src/index.js';

const SECRET = 'whsec_test_super_secret';

function sign(id: string, ts: number, body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${id}.${ts}.${body}`).digest('base64url');
}

const validBody = JSON.stringify({
  id: 'evt_1',
  type: 'trade.completed',
  createdAt: '2026-05-09T00:00:00Z',
  data: { trade: { id: 'T1' } },
});

describe('verifyWebhook', () => {
  it('accepts a valid signature and returns the typed event', () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = sign('evt_1', ts, validBody);
    const event = verifyWebhook(validBody, {
      'webhook-id': 'evt_1',
      'webhook-timestamp': String(ts),
      'webhook-signature': `t=${ts},s=${sig}`,
    }, { secret: SECRET });

    expect(event.id).toBe('evt_1');
    expect(event.type).toBe('trade.completed');
  });

  it('accepts the rotation s1= alternative when current s= mismatches', () => {
    const ts = Math.floor(Date.now() / 1000);
    const oldSig = sign('evt_1', ts, validBody, 'old_secret');
    const newSigBogus = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const event = verifyWebhook(validBody, {
      'webhook-id': 'evt_1',
      'webhook-timestamp': String(ts),
      'webhook-signature': `t=${ts},s=${newSigBogus},s1=${oldSig}`,
    }, { secret: 'old_secret' });

    expect(event.type).toBe('trade.completed');
  });

  it('rejects a tampered body', () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = sign('evt_1', ts, validBody);
    const tampered = validBody.replace('T1', 'T2');

    try {
      verifyWebhook(tampered, {
        'webhook-id': 'evt_1',
        'webhook-timestamp': String(ts),
        'webhook-signature': `t=${ts},s=${sig}`,
      }, { secret: SECRET });
      throw new Error('should have thrown');
    } catch (e) {
      expect(isError(e, 'INVALID_SIGNATURE')).toBe(true);
    }
  });

  it('rejects a stale timestamp outside tolerance', () => {
    const stale = Math.floor(Date.now() / 1000) - 600;
    const sig = sign('evt_1', stale, validBody);
    try {
      verifyWebhook(validBody, {
        'webhook-id': 'evt_1',
        'webhook-timestamp': String(stale),
        'webhook-signature': `t=${stale},s=${sig}`,
      }, { secret: SECRET, toleranceSeconds: 300 });
      throw new Error('should have thrown');
    } catch (e) {
      expect(isError(e, 'INVALID_SIGNATURE')).toBe(true);
    }
  });

  it('rejects when t= and webhook-timestamp disagree', () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = sign('evt_1', ts, validBody);
    try {
      verifyWebhook(validBody, {
        'webhook-id': 'evt_1',
        'webhook-timestamp': String(ts),
        'webhook-signature': `t=${ts + 1},s=${sig}`,
      }, { secret: SECRET });
      throw new Error('should have thrown');
    } catch (e) {
      expect(isError(e, 'INVALID_SIGNATURE')).toBe(true);
    }
  });

  it('rejects on missing headers', () => {
    try {
      verifyWebhook(validBody, {}, { secret: SECRET });
      throw new Error('should have thrown');
    } catch (e) {
      expect(isError(e, 'INVALID_SIGNATURE')).toBe(true);
    }
  });

  it('reads from a Headers instance too', () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = sign('evt_1', ts, validBody);
    const headers = new Headers({
      'webhook-id': 'evt_1',
      'webhook-timestamp': String(ts),
      'webhook-signature': `t=${ts},s=${sig}`,
    });
    const event = verifyWebhook(validBody, headers, { secret: SECRET });
    expect(event.id).toBe('evt_1');
  });

  it('accepts Buffer rawBody', () => {
    const ts = Math.floor(Date.now() / 1000);
    const sig = sign('evt_1', ts, validBody);
    const event = verifyWebhook(Buffer.from(validBody, 'utf8'), {
      'webhook-id': 'evt_1',
      'webhook-timestamp': String(ts),
      'webhook-signature': `t=${ts},s=${sig}`,
    }, { secret: SECRET });
    expect(event.type).toBe('trade.completed');
  });
});
