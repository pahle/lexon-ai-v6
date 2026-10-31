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
  ],
});
