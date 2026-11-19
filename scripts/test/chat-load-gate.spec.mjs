import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../../.github/workflows/chat-sse-load.yml', import.meta.url),
  'utf8',
);

test('hosted load is a blocking gate that still uploads evidence', () => {
  assert.doesNotMatch(workflow, /continue-on-error/u);
  assert.match(workflow, /run: pnpm test:load:chat/u);
  assert.match(
    workflow,
    /name: Upload safe chat SSE load evidence\n {8}if: always\(\)/u,
  );
});
