import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync('.github/workflows/real-evals.yml', 'utf8');
const ci = readFileSync('.github/workflows/ci.yml', 'utf8');

test('real evaluations are manually dispatched only on trusted main', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request_target:|pull_request:|schedule:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /timeout-minutes: (?:[1-9]|[1-5][0-9])/);
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.match(workflow, /concurrency:\s*\n\s+group:/);
  assert.match(workflow, /OPENROUTER_API_KEY:\s*\$\{\{ secrets\./);
  assert.match(workflow, /LEXON_OPENROUTER_ZDR_ONLY_VERIFIED:\s*\$\{\{ vars\./);
  assert.match(
    workflow,
    /LEXON_REAL_EVAL_ALLOCATION_ATTESTED:\s*\$\{\{ vars\./,
  );
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /pnpm\/action-setup@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40}/);
  assert.match(workflow, /pnpm --filter @lexon\/evals eval:real/);
});

test('real workflow output is score-only and PR mock evals remain in the CI test gate', () => {
  assert.match(workflow, /score/i);
  assert.doesNotMatch(workflow, /echo .*OPENROUTER_API_KEY|printenv|set -x/);
  assert.match(ci, /pull_request:/);
  assert.match(ci, /pnpm test/);
  const pushBranches = ci.match(
    /push:\s*\n\s+branches:\s*\n((?:\s+- [^\n]+\n)+)/,
  );
  assert.ok(pushBranches);
  assert.deepEqual(
    pushBranches[1]
      .trim()
      .split(/\s*-\s*/)
      .filter(Boolean),
    ['main'],
  );
});
