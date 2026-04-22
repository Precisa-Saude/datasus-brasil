import base from '@precisa-saude/eslint-config/base';

export default [
  ...base,
  {
    // Test files are excluded from package tsconfigs (to keep tsc --noEmit tight),
    // so disable type-aware parsing for them or ESLint errors trying to locate a project.
    files: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts'],
    languageOptions: {
      parserOptions: { project: false },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
      'max-lines': 'off',
      'max-lines-per-function': 'off',
    },
  },
  {
    // Scripts de build/manutenção rodam fora do tsconfig dos packages
    // (eles não são publicados) e precisam console pra logar progresso.
    files: ['scripts/**/*.ts', 'packages/*/scripts/**/*.ts'],
    languageOptions: {
      parserOptions: { project: false },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'off',
      'no-console': 'off',
    },
  },
];
