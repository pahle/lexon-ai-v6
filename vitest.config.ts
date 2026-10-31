import { defineConfig } from 'vitest/config';
export default defineConfig({
  root: import.meta.dirname,
  test: {
    projects: [
      'backend/vitest.config.ts',
      'backend/vitest.integration.config.ts',
      'shared/vitest.config.ts',
      'frontend/vitest.config.ts',
      'evals/vitest.config.ts',
    ],
  },
});
