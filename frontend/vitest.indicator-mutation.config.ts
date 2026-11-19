import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: {
    name: 'indicator-mutation',
    environment: 'node',
    include: ['test/indicator-sequence.spec.tsx'],
    maxWorkers: 1,
  },
});
