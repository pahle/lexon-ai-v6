import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import lexon from './scripts/eslint/lexon-boundaries.mjs';
export default ts.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.test-build/**',
      '**/.stryker-tmp/**',
      '**/reports/**',
      '.agents/**',
      '.claude/**',
      '.superpowers/**',
      '.cache/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { lexon },
    rules: { 'lexon/boundaries': ['error', { root: import.meta.dirname }] },
  },
  {
    files: [
      'frontend/**/*.{js,jsx,mjs,cjs,ts,tsx}',
      'word-add-in/**/*.{js,jsx,mjs,cjs,ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'radix-ui',
              message: 'Lexon UI uses Base UI; do not import Radix directly.',
            },
          ],
          patterns: [
            {
              group: ['radix-ui/*', '@radix-ui/*'],
              message: 'Lexon UI uses Base UI; do not import Radix directly.',
            },
          ],
        },
      ],
      'lexon/server-boundary': 'error',
    },
  },
  {
    // Console pages compose the data views kit; they never draw their own table.
    files: ['frontend/src/app/(workspace)/platform/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'radix-ui',
              message: 'Lexon UI uses Base UI; do not import Radix directly.',
            },
          ],
          patterns: [
            {
              group: ['radix-ui/*', '@radix-ui/*'],
              message: 'Lexon UI uses Base UI; do not import Radix directly.',
            },
            {
              group: [
                '@/components/ui/table',
                '**/components/ui/table',
                '**/ui/table',
              ],
              message:
                'Platform console pages use the data views kit (@/components/data-views), not the table primitive.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['frontend/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // Backend specs must assert the exact rejection (code, status or
    // SQLSTATE); a bare `.rejects.toThrow()` (even with a sole `undefined`
    // argument) or `.rejects.toBeDefined()` proves only that *something* threw.
    files: ['backend/test/**/*.ts', 'backend/src/**/*.spec.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.object.type='CallExpression'][callee.object.property.name='rejects'][callee.property.name=/^toThrow(Error)?$/][arguments.length=0]",
          message: 'Assert the exact rejection (code, status or SQLSTATE).',
        },
        {
          selector:
            "CallExpression[callee.object.object.type='CallExpression'][callee.object.property.name='rejects'][callee.property.name=/^toThrow(Error)?$/][arguments.length=1][arguments.0.type='Identifier'][arguments.0.name='undefined']",
          message: 'Assert the exact rejection (code, status or SQLSTATE).',
        },
        {
          selector:
            "CallExpression[callee.object.object.type='CallExpression'][callee.object.property.name='rejects'][callee.property.name='toBeDefined']",
          message: 'Assert the exact rejection (code, status or SQLSTATE).',
        },
      ],
    },
  },
  prettier,
);
