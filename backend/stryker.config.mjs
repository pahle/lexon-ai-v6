export default {
  plugins: ['@stryker-mutator/vitest-runner'],
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.mutation.config.ts', related: false },
  mutate: [
    'src/infrastructure/db/authorization-predicate.ts',
    'src/modules/platform/job-envelope.ts',
  ],
  reporters: ['clear-text', 'html', 'json'],
  concurrency: 2,
  timeoutMS: 1000,
  timeoutFactor: 2,
  thresholds: { high: 80, low: 60, break: 0 },
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  ignorePatterns: ['dist', 'reports', '.test-build', '.next'],
};
