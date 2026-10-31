import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
export default ts.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/.test-build/**',
      '.agents/**',
      '.superpowers/**',
      '.cache/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  { languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  prettier,
);
