import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

// Integration tests hit the real API. Gate them behind an env var so CI
// runs unit-only by default; flip on via:
//   SKINSHARK_TEST_API_KEY=sk_... npm run test:integration
export default defineConfig({
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version),
  },
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    globals: false,
    pool: 'forks',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
