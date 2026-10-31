import { defineProject } from 'vitest/config';
export default defineProject({
  test: { name: 'backend-unit', include: ['test/**/*.spec.ts'] },
});
