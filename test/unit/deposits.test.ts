import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { Skinshark } from '../../src/index.js';

const BASE = 'https://api.skinshark.gg';
const API_KEY = 'sk_test_dep';

beforeEach(() => {
  if (!nock.isActive()) nock.activate();
  nock.disableNetConnect();
});
afterEach(() => {
  nock.cleanAll();
  nock.enableNetConnect();
});

describe('deposits.gate — quote then create', () => {
  it('quotes and creates a Gate Pay deposit on behalf of a sub-user', async () => {
    nock(BASE, { reqheaders: { 'on-behalf-of': 'u-7' } })
      .post('/user/wallet/deposit/gate/quote', { currency: 'USDT', amount: '100.00' })
      .reply(200, {
        requestId: 'req-q1', success: true,
        data: {
          token: 'USDT', currency: 'USD',
          payAmountToken: 100.5, receiveAmountUsd: 100, receiveAmount: 100,
          fee: 0.5, exchangeRate: 1,
          quoteToken: 'qt_xyz', expiresIn: '5m',
        },
      });

    nock(BASE, { reqheaders: { 'on-behalf-of': 'u-7' } })
      .post('/user/wallet/deposit/gate', { quoteToken: 'qt_xyz', chain: 'TRX' })
      .reply(200, {
        requestId: 'req-c1', success: true,
        data: {
          fundingId: 'f-1', status: 'initiated', currency: 'USD',
          payAmountToken: 100.5, receiveAmountUsd: 100, receiveAmount: 100,
          exchangeRate: 1, fee: 0.5, expireTime: 1900000000,
          whitelabelUrl: 'https://gateway/x',
          onChain: { network: 'TRX', token: 'USDT', address: 'TXyz...' },
        },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const quote = await sdk.deposits.gate.quote(
      { currency: 'USDT', amount: '100.00' },
      { onBehalfOf: 'u-7' },
    );
    expect(quote.quoteToken).toBe('qt_xyz');

    const dep = await sdk.deposits.gate.create(
      { quoteToken: quote.quoteToken, chain: 'TRX' },
      { onBehalfOf: 'u-7' },
    );
    expect(dep.fundingId).toBe('f-1');
    expect(dep.onChain.address).toBe('TXyz...');
  });
});

describe('deposits cancel/resume', () => {
  it('cancels a deposit by id', async () => {
    nock(BASE)
      .post('/user/wallet/deposit/dep-1/cancel')
      .reply(200, {
        requestId: 'req-cn', success: true,
        data: { depositId: 'dep-1', status: 'cancelled' },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const r = await sdk.deposits.cancel('dep-1');
    expect(r.status).toBe('cancelled');
  });

  it('resumes a deposit by id', async () => {
    nock(BASE)
      .post('/user/wallet/deposit/dep-1/resume')
      .reply(200, {
        requestId: 'req-rs', success: true,
        data: {
          fundingId: 'dep-1', status: 'pending', method: 'gatepay',
          currency: 'USD', amount: 100,
          whitelabelUrl: 'https://gateway/x', onChain: null,
        },
      });

    const sdk = new Skinshark({ apiKey: API_KEY });
    const r = await sdk.deposits.resume('dep-1');
    expect(r.method).toBe('gatepay');
    expect(r.status).toBe('pending');
  });
});
