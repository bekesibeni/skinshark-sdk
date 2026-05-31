import { readFileSync } from 'node:fs';
import { defineConfig } from 'tsdown';

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'types/index': 'src/types/index.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  // tsdown defaults fixedExtension to true on the node platform, which would emit
  // .mjs/.d.mts. Keep .js/.d.ts so the package.json exports map stays valid.
  fixedExtension: false,
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  shims: false,
  outDir: 'dist',
  define: {
    __SDK_VERSION__: JSON.stringify(pkg.version),
  },
});
