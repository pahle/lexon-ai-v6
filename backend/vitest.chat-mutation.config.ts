import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'chat-mutation',
    include: [
      'test/unit/chat-search.service.spec.ts',
      'test/unit/chat-history-context.spec.ts',
      'src/infrastructure/db/ai-chat-resource.repository.spec.ts',
      'test/unit/stream-hub.spec.ts',
    ],
    maxWorkers: 1,
  },
});
