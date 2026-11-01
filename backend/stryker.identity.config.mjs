export default {
  plugins: ['@stryker-mutator/vitest-runner'],
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.identity-mutation.config.ts', related: false },
  mutate: [
    'src/modules/identity-access/identity-policy.ts',
    'src/modules/identity-access/session-evidence.ts',
    'src/modules/organizations/invitation-policy.ts',
  ],
  reporters: ['clear-text', 'html', 'json'],
  concurrency: 2,
  timeoutMS: 5000,
  timeoutFactor: 2,
  thresholds: { high: 80, low: 60, break: 80 },
  htmlReporter: { fileName: 'reports/mutation-identity/mutation.html' },
  jsonReporter: { fileName: 'reports/mutation-identity/mutation.json' },
  ignorePatterns: ['dist', 'reports', '.test-build', '.next'],
};
