import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    name: 'backend-mutation',
    include: [
      'test/unit/authorization-predicate.spec.ts',
      'test/unit/job-envelope.spec.ts',
    ],
    maxWorkers: 1,
  },
});
