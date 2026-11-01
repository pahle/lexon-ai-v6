import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
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
      'lexon/circular-shape': 'error',
    },
  },
  prettier,
);
