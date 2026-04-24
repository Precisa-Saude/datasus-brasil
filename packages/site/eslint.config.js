import baseReactConfig from '@precisa-saude/eslint-config/react';

export default [
  ...baseReactConfig,
  {
    // Scripts de build (geração de agregados) rodam fora do tsconfig
    // principal; desliga type-aware parsing para evitar "not included".
    files: ['scripts/**/*.ts'],
    languageOptions: {
      parserOptions: { project: false },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'no-console': 'off',
    },
  },
  {
    ignores: ['dist/**', 'coverage/**', '.turbo/**'],
  },
];
