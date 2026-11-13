export default {
  plugins: ['@stryker-mutator/vitest-runner'],
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.chat-mutation.config.ts',
    related: false,
  },
  mutate: [
    'src/modules/chat/chat-search.service.ts',
    'src/modules/chat/chat-history-context.ts',
    'src/infrastructure/db/ai-chat-resource.repository.ts',
    'src/infrastructure/queue/stream-hub.ts:750-809',
  ],
  reporters: ['clear-text', 'html', 'json'],
  concurrency: 2,
  timeoutMS: 5000,
  timeoutFactor: 2,
  thresholds: { high: 80, low: 60, break: 80 },
  htmlReporter: { fileName: 'reports/mutation-chat/mutation.html' },
  jsonReporter: { fileName: 'reports/mutation-chat/mutation.json' },
  ignorePatterns: ['dist', 'reports', '.test-build', '.next'],
};
