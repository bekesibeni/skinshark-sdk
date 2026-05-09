import { defineConfig } from 'vitest/config';

// Integration tests hit the real API. Gate them behind an env var so CI
// runs unit-only by default; flip on via:
//   SKINSHARK_TEST_API_KEY=sk_... npm run test:integration
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    globals: false,
    pool: 'forks',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
