import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');

test('Compose CI always uploads F4 chat review captures for 14 days', () => {
  const composeStep = workflow.indexOf(
    'name: Full Compose browser API and topology layer',
  );
  const artifactStep = workflow.indexOf(
    'name: Upload F4 chat preview captures',
  );
  assert.ok(composeStep >= 0);
  assert.ok(artifactStep > composeStep);

  const step = workflow.slice(
    artifactStep,
    workflow.indexOf('\n      - ', artifactStep + 1),
  );
  assert.match(step, /if:\s*always\(\)/u);
  assert.match(
    step,
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u,
  );
  assert.match(step, /name: f4-chat-preview-\$\{\{ github\.sha \}\}/u);
  assert.match(step, /test-results\/f4-chat\/\*\.png/u);
  assert.match(step, /test-results\/f4-chat\/\*\.json/u);
  assert.match(step, /retention-days:\s*14/u);
  assert.match(step, /if-no-files-found:\s*ignore/u);
});
