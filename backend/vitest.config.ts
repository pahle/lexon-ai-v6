import { defineProject } from 'vitest/config';
export default defineProject({
  test: {
    name: 'backend-unit',
    include: ['test/unit/**/*.spec.ts', 'src/infrastructure/ai/**/*.spec.ts'],
  },
});
