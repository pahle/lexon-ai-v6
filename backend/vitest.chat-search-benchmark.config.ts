import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: {
    include: ['test/integration/chat-search-performance.spec.ts'],
    globalSetup: ['test/setup/search-benchmark-global-setup.ts'],
    testTimeout: 900_000,
    hookTimeout: 60_000,
    maxWorkers: 1,
    fileParallelism: false,
  },
});
