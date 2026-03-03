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
    files: ['tools/**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    rules: {
      'no-unused-vars': 'off',
    },
  },
];
