import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    name: 'job-title-mutation',
    include: ['test/job-title.spec.ts'],
    maxWorkers: 1,
  },
});
