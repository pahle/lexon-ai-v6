import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  timeout: 45000,
  expect: { timeout: 10000 },
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  use: { headless: true, trace: 'retain-on-failure' },
  projects: [
    {
      name: 'runtime-health',
      testMatch: 'backend/test/e2e/runtime-health.spec.ts',
    },
    { name: 'backend-api', testMatch: 'backend/test/e2e/api.spec.ts' },
    {
      name: 'frontend-browser',
      testMatch: 'frontend/test/e2e/health-page.spec.ts',
    },
    {
      name: 'topology',
      testMatch: [
        'backend/test/e2e/topology.spec.ts',
        'backend/test/e2e/valkey-policy.spec.ts',
      ],
    },
    {
      name: 'evaluation-smoke',
      testMatch: 'backend/test/e2e/api.spec.ts',
      grep: /evaluation export/,
    },
  ],
});
