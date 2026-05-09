import { createHmac, timingSafeEqual } from 'node:crypto';
import { SkinsharkError } from './errors.js';
import type { WebhookEvent } from './types/webhooks.js';

export interface VerifyWebhookOptions {
  /** Webhook secret as configured in the merchant dashboard. */
  secret: string;
  /**
   * Maximum age of the signed timestamp in seconds. Older requests are rejected
   * to mitigate replay attacks. Default: 300s (5 min). Set to 0 to disable.
   */
  toleranceSeconds?: number;
}

type HeaderInput = Headers | Record<string, string | string[] | undefined>;

function readHeader(headers: HeaderInput, name: string): string | undefined {
  const lc = name.toLowerCase();
  if (headers instanceof Headers || typeof (headers as unknown as Headers).get === 'function') {
    return (headers as unknown as Headers).get(lc) ?? undefined;
  }
  const v = (headers as Record<string, string | string[] | undefined>)[lc];
  return Array.isArray(v) ? v[0] : v;
}

function parseSignatureHeader(header: string): { tRaw: string; t: number; sigs: string[] } {
  let tRaw: string | undefined;
  let t: number | undefined;
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq);
    const v = trimmed.slice(eq + 1);
    if (k === 't') {
      const parsed = Number(v);
      if (Number.isFinite(parsed)) {
        tRaw = v;
        t = parsed;
      }
    } else if (k === 's' || k === 's1') {
      sigs.push(v);
    }
  }
  if (tRaw === undefined || t === undefined) {
    throw new SkinsharkError({
      code: 0, key: 'INVALID_SIGNATURE', message: 'Missing t= in webhook-signature header',
    });
  }
  if (sigs.length === 0) {
    throw new SkinsharkError({
      code: 0, key: 'INVALID_SIGNATURE', message: 'Missing s=/s1= in webhook-signature header',
    });
  }
  return { tRaw, t, sigs };
}

function constantTimeEquals(a: string, b: string): boolean {
  // Both inputs are base64url HMAC outputs; equal length is required by timingSafeEqual.
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Verify a SkinShark webhook delivery. Throws SkinsharkError on missing
 * headers, bad signature, or expired timestamp. Returns the typed event on
 * success.
 *
 * @param rawBody The raw HTTP request body (string or Buffer). Must be
 *                the bytes the server signed — do NOT re-stringify a parsed
 *                JSON object, since whitespace would differ.
 * @param headers Inbound request headers (Headers, Express req.headers, etc.).
 * @param options.secret The webhook secret (from the dashboard).
 * @param options.toleranceSeconds Replay window. Default 300s.
 */
export function verifyWebhook(
  rawBody: string | Buffer,
  headers: HeaderInput,
  options: VerifyWebhookOptions,
): WebhookEvent {
  const id = readHeader(headers, 'webhook-id');
  const timestamp = readHeader(headers, 'webhook-timestamp');
  const signatureHeader = readHeader(headers, 'webhook-signature');

  if (!id || !timestamp || !signatureHeader) {
    throw new SkinsharkError({
      code: 0,
      key: 'INVALID_SIGNATURE',
      message: 'Missing webhook-id, webhook-timestamp, or webhook-signature header',
    });
  }

  const { tRaw, t, sigs } = parseSignatureHeader(signatureHeader);
  // Byte-equal comparison so leading zeros / whitespace can't pass via Number normalization.
  if (tRaw !== timestamp) {
    throw new SkinsharkError({
      code: 0, key: 'INVALID_SIGNATURE',
      message: 'webhook-timestamp does not match t= in webhook-signature',
    });
  }

  const tolerance = options.toleranceSeconds ?? 300;
  if (tolerance > 0) {
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - t) > tolerance) {
      throw new SkinsharkError({
        code: 0, key: 'INVALID_SIGNATURE',
        message: `Webhook timestamp outside tolerance (${tolerance}s)`,
      });
    }
  }

  // HMAC consumes Buffer or string directly — no need to materialize Buffer→string before signing.
  const expected = createHmac('sha256', options.secret)
    .update(`${id}.${timestamp}.`)
    .update(rawBody)
    .digest('base64url');

  let matched = false;
  for (const sig of sigs) {
    if (constantTimeEquals(sig, expected)) {
      matched = true;
      break;
    }
  }
  if (!matched) {
    throw new SkinsharkError({
      code: 0, key: 'INVALID_SIGNATURE', message: 'Webhook signature mismatch',
    });
  }

  // Only stringify and parse after signature passes — bad signatures don't pay
  // the JSON cost.
  const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  try {
    return JSON.parse(bodyStr) as WebhookEvent;
  } catch (cause) {
    throw new SkinsharkError({
      code: 0, key: 'SDK_INVALID_RESPONSE',
      message: 'Webhook body is not valid JSON', cause,
    });
  }
}
