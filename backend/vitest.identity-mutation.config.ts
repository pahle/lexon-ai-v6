import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    name: 'identity-mutation',
    include: [
      'test/unit/identity-policy.spec.ts',
      'test/unit/session-evidence.spec.ts',
      'test/unit/invitation-policy.spec.ts',
    ],
    maxWorkers: 1,
  },
});
