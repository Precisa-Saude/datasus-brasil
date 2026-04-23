import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Config de teste do site. Estende a lógica do vitest root mas com
 * overrides específicos para o frontend:
 *
 * - Componentes que apenas compõem bibliotecas externas (Mapbox GL JS,
 *   BrowserRouter, layout puro) ficam fora da cobertura — testá-los
 *   unitariamente vira mock-vs-mock sem sinal real. Eles são
 *   verificados em runtime (golden path manual com `pnpm dev`).
 * - `aggregates.ts` é só tipos TS (apaga no build).
 * - `scripts/aggregate-sia.ts` é one-shot de pipeline, não runtime.
 */
export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    coverage: {
      exclude: [
        '**/dist/**',
        '**/node_modules/**',
        'scripts/**',
        'src/aggregates.ts',
        'src/lib/aggregates.ts',
        // Componentes Mapbox: integração com biblioteca externa, test em
        // jsdom vira mock-vs-mock; verificados via golden path manual.
        'src/components/MapView.tsx',
        'src/components/MunicipioMapView.tsx',
        // Composição/layout — sem lógica própria.
        'src/App.tsx',
        'src/main.tsx',
        'src/components/Nav.tsx',
        'src/components/Footer.tsx',
        // Páginas: majoritariamente composição + fetch; validadas
        // manualmente. Lógica de fato testável foi extraída pra libs.
        'src/pages/**',
        'vite.config.ts',
        'vitest.config.ts',
        'tailwind.config.js',
        'eslint.config.js',
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
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
  },
});
