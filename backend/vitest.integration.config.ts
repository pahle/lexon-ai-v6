import { defineProject } from 'vitest/config';
export default defineProject({
  test: {
    name: 'backend-integration',
    include: ['test/integration/**/*.spec.ts'],
    globalSetup: [
      '../scripts/test/prepare-packages.ts',
      'test/setup/global-infrastructure.ts',
    ],
    testTimeout: 30000,
    hookTimeout: 60000,
    maxWorkers: 2,
    sequence: { groupOrder: 1 },
  },
});
