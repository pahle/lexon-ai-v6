import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  timeout: 45000,
  expect: { timeout: 10000 },
  snapshotPathTemplate: '{testDir}/docs/references/F4.1-visual/{arg}{ext}',
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  use: { headless: true, trace: 'off' },
  projects: [
    {
      name: 'identity-api',
      testMatch: [
        'backend/test/e2e/identity-api.spec.ts',
        'backend/test/e2e/rate-limit-proxy.spec.ts',
        'backend/test/e2e/foreign-org-bearer.spec.ts',
        'backend/test/e2e/platform-console-api.spec.ts',
        'backend/test/e2e/account-invitations.spec.ts',
        'backend/test/e2e/signup-account-invitation.spec.ts',
      ],
      use: { trace: 'off', video: 'off', screenshot: 'off' },
    },
    {
      name: 'identity-browser',
      use: {
        trace: 'off',
        video: 'off',
        screenshot: 'off',
        deviceScaleFactor: 1,
        locale: 'en-US',
        timezoneId: 'Asia/Jakarta',
      },
      testMatch: [
        'backend/test/e2e/*entry.spec.ts',
        'backend/test/e2e/account-security.spec.ts',
        'backend/test/e2e/organizations.spec.ts',
        'backend/test/e2e/platform-identity.spec.ts',
        'backend/test/e2e/platform-console-browser.spec.ts',
        'backend/test/e2e/platform-setup-open-signup.spec.ts',
        'backend/test/e2e/app-shell.spec.ts',
        'backend/test/e2e/theme-before-hydration.spec.ts',
        'backend/test/e2e/shell-accessibility.spec.ts',
        'backend/test/e2e/brand-layout.spec.ts',
      ],
    },
    {
      name: 'runtime-health',
      testMatch: 'backend/test/e2e/runtime-health.spec.ts',
    },
    { name: 'backend-api', testMatch: 'backend/test/e2e/api.spec.ts' },
    {
      name: 'chat-routing',
      testMatch: 'backend/test/e2e/chat-routing.spec.ts',
    },
    {
      name: 'chat-runtime-proof',
      timeout: 90000,
      testMatch: [
        'backend/test/e2e/chat-runtime-proof.spec.ts',
        'backend/test/e2e/chat-recovery.spec.ts',
        'backend/test/e2e/indicator-trace.spec.ts',
      ],
      use: { trace: 'retain-on-failure', video: 'off', screenshot: 'off' },
    },
    {
      name: 'chat-browser',
      timeout: 90000,
      testMatch: [
        'backend/test/e2e/chat-thread.spec.ts',
        'backend/test/e2e/chat-history.spec.ts',
        'backend/test/e2e/chat-accessibility.spec.ts',
        'backend/test/e2e/chat-states.spec.ts',
        'backend/test/e2e/chat-copy.spec.ts',
        'backend/test/e2e/chat-long-stress.spec.ts',
        'backend/test/e2e/mobile-sheet.spec.ts',
      ],
      use: {
        trace: 'off',
        video: 'off',
        screenshot: 'off',
        deviceScaleFactor: 1,
        locale: 'en-US',
        timezoneId: 'Asia/Jakarta',
      },
    },
    {
      name: 'frontend-browser',
      testMatch: 'frontend/test/e2e/health-page.spec.ts',
    },
    {
      name: 'brand-visual',
      timeout: 240000,
      testMatch: [
        'backend/test/e2e/brand-visual-auth.spec.ts',
        'backend/test/e2e/brand-visual-shell.spec.ts',
        'backend/test/e2e/brand-visual-chat.spec.ts',
        'backend/test/e2e/brand-visual-chats-settings.spec.ts',
        'backend/test/e2e/brand-visual-platform.spec.ts',
        'backend/test/e2e/brand-visual-platform-accounts.spec.ts',
        'backend/test/e2e/brand-visual-platform-organizations.spec.ts',
        'backend/test/e2e/visual-comparison-regression.spec.ts',
      ],
      snapshotPathTemplate: '{testDir}/docs/references/F4.1-visual/{arg}{ext}',
      use: {
        deviceScaleFactor: 1,
        locale: 'en-US',
        timezoneId: 'Asia/Jakarta',
        reducedMotion: 'reduce',
      },
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
    ...(process.env.LEXON_CHAT_LOAD === '1'
      ? [
          {
            name: 'chat-sse-load',
            timeout: 180_000,
            testMatch: [
              'backend/test/e2e/chat-sse-load.spec.ts',
              'backend/test/e2e/chat-sse-load.z-burst.spec.ts',
            ],
            use: {
              trace: 'off' as const,
              video: 'off' as const,
              screenshot: 'off' as const,
            },
          },
        ]
      : []),
  ],
});
