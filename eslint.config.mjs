import js from '@eslint/js';

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/apps/frontend/out/**',
      '**/docs/src/js/**',
      '**/apps/backend/prisma/migrations/**',
    ],
  },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': 'off',
    },
  },
];
