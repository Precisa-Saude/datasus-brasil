import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        '**/dist/**',
        '**/tsup.config.ts',
        '**/src/cli/index.ts',
        '**/packages/cli/src/index.ts',
        // Build-time scripts geram tabelas de códigos — não fazem parte
        // do runtime publicado.
        '**/scripts/**',
        // Arquivos só de tipo TypeScript — apagam no build, então a
        // cobertura sempre cai para 0/0/0 e polui o cálculo agregado.
        '**/types.ts',
      ],
      provider: 'v8',
      reporter: ['text', 'lcov'],
      thresholds: {
        branches: 80,
        functions: 80,
        lines: 80,
        statements: 80,
      },
    },
  },
});
