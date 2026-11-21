import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// CI speed (ci/speed): browser cache, docs-only skipping that fails safe,
// path-gated mutation gates, and concurrency that never cancels main.

const ci = readFileSync(
  new URL('../../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);
const jobBlock = (name) => {
  const match = new RegExp(
    `\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][a-z0-9-]*:\\n|$)`,
    'u',
  ).exec(ci);
  assert.ok(match, `job ${name} exists`);
  return match[1];
};
const steps = (job) => job.split(/\r?\n(?=\s{6}- (?:name|uses|run|id): )/u);
const RUN_ALL =
  "needs.changes.result != 'success' || needs.changes.outputs.docs_only != 'true'";

test('required check names are unchanged', () => {
  assert.match(ci, /\n {2}unit-integration:\n/u);
  assert.match(
    ci,
    /\n {2}compose-e2e:\n {4}name: compose-e2e \(\$\{\{ matrix\.shard \}\}\/3\)\n/u,
  );
  assert.match(ci, /\n {2}merge-e2e:\n/u);
});

test('a changes job classifies the pull request files with the tested classifier', () => {
  const job = jobBlock('changes');
  assert.match(job, /pull-requests: read/u);
  assert.match(job, /node scripts\/ci-changes\.mjs/u);
  for (const output of [
    'docs_only',
    'mutation_identity',
    'mutation_contracts',
    'mutation_indicator',
  ])
    assert.match(
      job,
      new RegExp(
        `${output}: \\$\\{\\{ steps\\.classify\\.outputs\\.${output} \\}\\}`,
        'u',
      ),
    );
});

test('merge-e2e skips at job level only for a successful docs-only classification', () => {
  const job = jobBlock('merge-e2e');
  assert.match(job, /needs: \[changes, compose-e2e\]/u);
  const condition = /\n {4}if: \$\{\{ (.+) \}\}\n/u.exec(job)?.[1];
  assert.ok(condition, 'merge-e2e has a job-level if');
  assert.match(condition, /!cancelled\(\)/u);
  assert.ok(condition.includes(`(${RUN_ALL})`), condition);
});

test('unit-integration always runs the docs gates and gates only the code steps', () => {
  const job = jobBlock('unit-integration');
  assert.match(job, /needs: changes/u);
  assert.match(job, /\n {4}if: \$\{\{ !cancelled\(\) \}\}\n/u);
  assert.ok(job.includes(`LEXON_RUN_ALL: \${{ ${RUN_ALL} }}`));
  const list = steps(job);
  const ungated = [
    'Formatting',
    'Tooling and cleanup assertions',
    'Docs-only change, code gates not needed',
  ];
  for (const name of ungated) {
    const step = list.find((s) => s.includes(`name: ${name}`));
    assert.ok(step, name);
  }
  for (const name of [
    'Root lint',
    'Package gates in dependency order',
    'Unit and isolated Testcontainers integration',
  ]) {
    const step = list.find((s) => s.includes(`name: ${name}`));
    assert.ok(step, name);
    assert.match(step, /if: env\.LEXON_RUN_ALL == 'true'/u, name);
  }
  // Formatting and the tooling tests (which read docs) are never skipped.
  // The tooling tests run backend/dist; a docs-only run builds it.
  const build = list.find((s) =>
    s.includes('name: Build what the tooling tests run (docs-only)'),
  );
  assert.ok(build);
  assert.match(build, /if: env\.LEXON_RUN_ALL != 'true'/u);
  assert.match(build, /pnpm --filter @lexon\/backend build/u);
  for (const name of ['Formatting', 'Tooling and cleanup assertions'])
    assert.doesNotMatch(
      list.find((s) => s.includes(`name: ${name}`)),
      /\n\s+if: /u,
      name,
    );
});

test('compose-e2e always runs its matrix (names stay expanded) and gates every step after the decision', () => {
  const job = jobBlock('compose-e2e');
  assert.match(job, /needs: changes/u);
  assert.match(job, /\n {4}if: \$\{\{ !cancelled\(\) \}\}\n/u);
  assert.ok(
    job.includes(`LEXON_RUN_E2E: \${{ ${RUN_ALL} }}`),
    'the job computes LEXON_RUN_E2E fail-safe',
  );
  const list = steps(job.slice(job.indexOf('steps:')));
  const decision = list.findIndex((s) =>
    /name: Docs-only change, E2E not needed/u.test(s),
  );
  assert.ok(decision > 0, 'a visible step reports the docs-only skip');
  assert.match(list[decision], /if: env\.LEXON_RUN_E2E != 'true'/u);
  // Every later step is gated, except the always()/failure() reporting
  // steps, which are harmless on a docs-only run: their uploads ignore
  // missing files, or they depend on a gated step's output, or they only
  // run on a manual dispatch (never docs-only).
  const harmless = (step) =>
    /\n\s+if: (?:always|failure)\(\)/u.test(step) &&
    (/if-no-files-found: ignore/u.test(step) ||
      /steps\.visual-pending\.outputs\.ids != ''/u.test(step) ||
      /github\.event_name == 'workflow_dispatch'/u.test(step));
  for (const step of list.slice(1)) {
    if (step === list[decision] || harmless(step)) continue;
    assert.match(
      step,
      /if: [^\n]*env\.LEXON_RUN_E2E == 'true'/u,
      `step is gated: ${step.trim().split('\n')[0]}`,
    );
  }
});

test('each mutation gate runs on its guarded paths and fails safe', () => {
  const job = jobBlock('unit-integration');
  for (const [name, output] of [
    ['Identity policy mutation gate', 'mutation_identity'],
    ['Job title contract mutation gate', 'mutation_contracts'],
    ['Thinking indicator mutation gate', 'mutation_indicator'],
  ]) {
    const step = steps(job).find((s) => s.includes(`name: ${name}`));
    assert.ok(step, name);
    assert.ok(
      step.includes(
        `if: env.LEXON_RUN_ALL == 'true' && (needs.changes.result != 'success' || needs.changes.outputs.${output} == 'true')`,
      ),
      step,
    );
  }
});

test('Playwright browsers are cached on the exact Playwright version and installed only on a miss', () => {
  for (const name of ['unit-integration', 'compose-e2e', 'visual-assemble']) {
    const job = jobBlock(name);
    assert.match(
      job,
      /actions\/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4\.3\.0/u,
      name,
    );
    assert.match(job, /path: ~\/\.cache\/ms-playwright/u, name);
    assert.match(
      job,
      /key: playwright-chromium-\$\{\{ runner\.os \}\}-\$\{\{ steps\.playwright\.outputs\.version \}\}/u,
      name,
    );
    assert.match(
      job,
      /require\('@playwright\/test\/package\.json'\)\.version/u,
      name,
    );
    const install = steps(job).find((s) =>
      /playwright install --with-deps chromium/u.test(s),
    );
    assert.ok(install, `${name} installs on a miss`);
    assert.match(
      install,
      /steps\.playwright-cache\.outputs\.cache-hit != 'true'/u,
    );
    const deps = steps(job).find((s) =>
      /playwright install-deps chromium/u.test(s),
    );
    assert.ok(deps, `${name} installs system dependencies on a hit`);
    assert.match(
      deps,
      /steps\.playwright-cache\.outputs\.cache-hit == 'true'/u,
    );
  }
});

test('concurrency groups per workflow and ref and cancels only pull requests', () => {
  assert.match(
    ci,
    /\nconcurrency:\n {2}group: lexon-\$\{\{ github\.workflow \}\}-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}\n/u,
  );
});
