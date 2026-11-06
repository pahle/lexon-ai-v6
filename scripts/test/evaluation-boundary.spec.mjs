import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';

const sourceFiles = [
  new URL('../../evals/global-setup.ts', import.meta.url),
  new URL('../../evals/test/f3-engine.spec.ts', import.meta.url),
];

test('keeps eval setup and scenarios behind the single public evaluation export', async () => {
  const sources = await Promise.all(
    sourceFiles.map((path) => readFile(path, 'utf8')),
  );
  for (const source of sources) {
    assert.match(source, /from ['"]@lexon\/backend\/evaluation['"]/);
    assert.doesNotMatch(source, /from ['"]@lexon\/backend\/(?!evaluation)/);
    assert.doesNotMatch(
      source,
      /from ['"].*backend\/(?:src|test|node_modules)\//,
    );
    assert.doesNotMatch(source, /from ['"](?:ai|ai\/test)['"]/);
  }
});
