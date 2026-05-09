import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { Skinshark } from '../../src/index.js';

const BASE = 'https://api.skinshark.gg';
const API_KEY = 'sk_test_users';

beforeEach(() => {
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
});
afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

describe('users.fund — idempotency', () => {
  it('auto-generates Idempotency-Key when not provided', async () => {
    let receivedKey: string | undefined;
    nock(BASE)
      .post('/merchant/users/u1/fund', { amount: '50.00' })
      .reply(function () {
        receivedKey = this.req.headers['idempotency-key'] as string | undefined;
        return [200, {
          requestId: 'req-f1', success: true,
          data: { transactionId: 't-1', idempotent: false },
        }];
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const result = await sdk.users.fund('u1', { amount: '50.00' });
    expect(result.transactionId).toBe('t-1');
    expect(receivedKey).toBeDefined();
    // UUID version nibble in byte 6 → string char position 14. v4 is the default.
    expect(receivedKey?.[14]).toBe('4');
  });

  it('honors caller-supplied Idempotency-Key', async () => {
    nock(BASE, { reqheaders: { 'idempotency-key': 'tx-abc' } })
      .post('/merchant/users/u1/fund')
      .reply(200, {
        requestId: 'req-f2', success: true,
        data: { transactionId: 't-2', idempotent: true },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const result = await sdk.users.fund('u1', { amount: '50.00' }, { idempotencyKey: 'tx-abc' });
    expect(result.transactionId).toBe('t-2');
    expect(result.idempotent).toBe(true);
  });

  it('surfaces TRANSFER_CURRENCY_MISMATCH cleanly', async () => {
    nock(BASE)
      .post('/merchant/users/u1/fund')
      .reply(422, {
        requestId: 'req-f3', success: false,
        error: { code: 1710, key: 'TRANSFER_CURRENCY_MISMATCH', message: 'Currency mismatch' },
      });

    const sdk = new Skinshark({ apiKey: API_KEY, retries: false });
    await expect(sdk.users.fund('u1', { amount: '50.00' })).rejects.toMatchObject({
      key: 'TRANSFER_CURRENCY_MISMATCH', code: 1710,
    });
  });
});
