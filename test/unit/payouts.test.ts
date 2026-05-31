import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { Skinshark, isError } from '../../src/index.js';

const BASE = 'https://api.skinshark.gg';
const API_KEY = 'sk_test_payout';

beforeEach(() => {
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
});
afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

describe('payouts — custody reads', () => {
  it('fetches the forwarder address', async () => {
    nock(BASE, { reqheaders: { 'api-key': API_KEY } })
      .get('/user/wallet/payout/crypto/address')
      .reply(200, {
        requestId: 'r1', success: true,
        data: { address: '0xabc', chains: ['ethereum', 'base'], tokens: ['USDT', 'USDC'] },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const res = await sdk.payouts.address();
    expect(res.address).toBe('0xabc');
    expect(res.tokens).toContain('USDC');
  });

  it('lists per-(chain,token) balances as cent strings', async () => {
    nock(BASE)
      .get('/user/wallet/payout/crypto/balances')
      .reply(200, {
        requestId: 'r2', success: true,
        data: { balances: [{ chain: 'ethereum', token: 'USDC', tokenAddress: '0xtok', balanceCents: '15000' }] },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const res = await sdk.payouts.balances();
    expect(res.balances[0]?.balanceCents).toBe('15000');
  });
});

describe('payouts — quote + withdraw', () => {
  it('quotes a withdrawal with 24h gas stats', async () => {
    nock(BASE)
      .post('/user/wallet/payout/crypto/withdraw/quote', { chain: 'ethereum', token: 'USDC', amountCents: '10000' })
      .reply(200, {
        requestId: 'r3', success: true,
        data: {
          chain: 'ethereum', token: 'USDC', amountCents: '10000',
          liveFeeUsdCents: '320', liveTotalDebitCents: '10320',
          stats24h: { minFeeUsdCents: '200', p25FeeUsdCents: '250', avgFeeUsdCents: '300', p75FeeUsdCents: '380', maxFeeUsdCents: '600' },
          computedAt: '2026-05-31T00:00:00.000Z',
        },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const q = await sdk.payouts.quote({ chain: 'ethereum', token: 'USDC', amountCents: '10000' });
    expect(q.liveTotalDebitCents).toBe('10320');
    expect(q.stats24h.p75FeeUsdCents).toBe('380');
  });

  it('submits a withdrawal keyed by externalId', async () => {
    nock(BASE)
      .post('/user/wallet/payout/crypto/withdraw', {
        chain: 'ethereum', token: 'USDC', destination: '0xdest', amountCents: '10000', externalId: 'ext-1',
      })
      .reply(200, {
        requestId: 'r4', success: true,
        data: {
          id: 'wd-1', status: 'pending_callback', chain: 'ethereum', token: 'USDC', destination: '0xdest',
          amountCents: '10000', feeCents: '320', externalId: 'ext-1', forUserId: null, forUserExternalId: null,
          createdAt: '2026-05-31T00:00:00.000Z',
        },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const wd = await sdk.payouts.withdraw({
      chain: 'ethereum', token: 'USDC', destination: '0xdest', amountCents: '10000', externalId: 'ext-1',
    });
    expect(wd.id).toBe('wd-1');
    expect(wd.status).toBe('pending_callback');
  });

  it('maps the kill-switch error key', async () => {
    nock(BASE)
      .get('/user/wallet/payout/crypto/balances')
      .reply(403, {
        requestId: 'r5', success: false,
        error: { code: 1820, key: 'CRYPTO_PAYOUT_NOT_ENABLED', message: 'Crypto payout custody is not enabled for this account' },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    try {
      await sdk.payouts.balances();
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(isError(e, 'CRYPTO_PAYOUT_NOT_ENABLED')).toBe(true);
    }
  });
});

describe('payouts — withdrawal lookups', () => {
  it('gets a single withdrawal by id', async () => {
    nock(BASE)
      .get('/user/wallet/payout/crypto/withdrawals/wd-9')
      .reply(200, {
        requestId: 'r6', success: true,
        data: {
          id: 'wd-9', status: 'refunded', chain: 'ethereum', token: 'USDC', tokenAddress: '0xtok',
          destination: '0xdest', amountCents: '10000', feeCents: '0', txHash: null,
          failureReason: 'callback rejected', externalId: 'ext-9', forUserId: null, forUserExternalId: null,
          callbackAttempts: 1, createdAt: '2026-05-31T00:00:00.000Z', broadcastAt: null, confirmedAt: null,
        },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const wd = await sdk.payouts.getWithdrawal('wd-9');
    expect(wd.status).toBe('refunded');
  });

  it('lists withdrawals with status filter', async () => {
    nock(BASE)
      .get('/user/wallet/payout/crypto/withdrawals')
      .query({ status: 'confirmed', limit: '10' })
      .reply(200, { requestId: 'r7', success: true, data: { items: [], nextCursor: null } });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const res = await sdk.payouts.listWithdrawals({ status: 'confirmed', limit: 10 });
    expect(res.nextCursor).toBeNull();
  });
});
