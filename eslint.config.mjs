import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'coverage/**',
    'next-env.d.ts',
    'playwright-report/**',
    'test-results/**',
  ]),
  {
    rules: {
      // Never log sensitive values; console use is restricted to the logger module.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: [
      'scripts/**/*.ts',
      'scripts/**/*.mjs',
      'tests/**/*.ts',
      'e2e/**/*.ts',
      'e2e-full/**/*.ts',
      'e2e-full/**/*.mjs',
    ],
    rules: { 'no-console': 'off' },
  },
]);
