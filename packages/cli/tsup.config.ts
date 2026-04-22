import { defineConfig } from 'tsup';

export default defineConfig({
  banner: {
    js: '#!/usr/bin/env node',
  },
  clean: true,
  dts: false,
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm'],
  sourcemap: true,
  splitting: false,
  target: 'node22',
});
