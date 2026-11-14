import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../../.github/workflows/chat-sse-load.yml', import.meta.url),
  'utf8',
);

test('hosted load is informational while the unchanged load command still runs and uploads evidence', () => {
  assert.match(
    workflow,
    /chat-sse-load:\n(?:[^\n]*\n)*? {4}continue-on-error: true\n/u,
  );
  assert.match(workflow, /run: pnpm test:load:chat/u);
  assert.match(
    workflow,
    /name: Upload safe chat SSE load evidence\n {8}if: always\(\)/u,
  );
});
