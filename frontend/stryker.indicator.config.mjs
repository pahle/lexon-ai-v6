export default {
  plugins: ['@stryker-mutator/vitest-runner'],
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.indicator-mutation.config.ts', related: false },
  mutate: ['src/components/chat/indicator/indicator-sequence.ts'],
  reporters: ['clear-text', 'html', 'json'],
  concurrency: 2,
  timeoutMS: 5000,
  timeoutFactor: 2,
  thresholds: { high: 80, low: 60, break: 80 },
  htmlReporter: { fileName: 'reports/mutation/mutation.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  ignorePatterns: ['dist', 'reports', '.test-build', '.next'],
};
