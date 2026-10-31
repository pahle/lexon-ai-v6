import { defineProject } from 'vitest/config';
export default defineProject({
  test: {
    environment: 'jsdom',
    name: 'frontend',
    include: ['test/**/*.spec.tsx'],
  },
});
