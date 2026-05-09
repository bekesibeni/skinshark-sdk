import { describe, expect, it } from 'vitest';
import { Skinshark, isError, meta } from '../../src/index.js';

const API_KEY = process.env.SKINSHARK_TEST_API_KEY;
const BASE_URL = process.env.SKINSHARK_TEST_BASE_URL ?? 'https://api.skinshark.gg';
const TEST_SUB_USER = process.env.SKINSHARK_TEST_SUB_USER;

const itLive = API_KEY ? it : it.skip;

describe('integration — live API smoke', () => {
  itLive('GET /merchant returns the merchant profile', async () => {
    const sdk = new Skinshark({ apiKey: API_KEY!, baseUrl: BASE_URL });
    const profile = await sdk.account.get();
    expect(profile.id).toBeTruthy();
    expect(profile.email).toBeTruthy();
    expect(meta(profile)?.requestId).toBeTruthy();
  });

  itLive('rejects with INVALID_API_KEY for a bogus key', async () => {
    const sdk = new Skinshark({ apiKey: 'sk_definitely_not_real_xxx', baseUrl: BASE_URL, retries: false });
    try {
      await sdk.account.get();
      throw new Error('should have thrown');
    } catch (e) {
      expect(isError(e)).toBe(true);
      // Either INVALID_API_KEY or UNAUTHORIZED depending on server config.
    }
  });

  itLive.runIf(Boolean(TEST_SUB_USER))(
    'sdk.as(SKINSHARK_TEST_SUB_USER) returns a scoped client',
    async () => {
      const sdk = new Skinshark({ apiKey: API_KEY!, baseUrl: BASE_URL });
      const u = await sdk.as(TEST_SUB_USER!);
      expect(u.id).toBeTruthy();
    },
  );
});
