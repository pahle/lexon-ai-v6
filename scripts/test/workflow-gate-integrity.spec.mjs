import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

const dir = new URL('../../.github/workflows/', import.meta.url);
const files = readdirSync(dir).filter((f) => /\.ya?ml$/u.test(f));

// Allowlist: file -> step names that may swallow failures (none today).
// Only artifact upload/cleanup steps may be listed, each with a reason.
const ALLOWED = new Map();

const SWALLOW = [
  [/^\s*(?:-\s+)?continue-on-error:\s*(?!false\b)\S/u, 'continue-on-error'],
  [/\|\|\s*(?:true|:|exit\s+0)\b/u, '|| true / || : / || exit 0'],
  [/\bset\s+\+e\b/u, 'set +e'],
  [/;\s*exit\s+0\b/u, '; exit 0'],
];

test('workflows exist', () => {
  assert.ok(files.length > 0);
});

for (const file of files) {
  test(`${file}: no gate step can swallow a failing exit code`, () => {
    const lines = readFileSync(new URL(file, dir), 'utf8').split(/\r?\n/u);
    const hits = [];
    lines.forEach((line, i) => {
      if (/^\s*#/u.test(line)) return;
      for (const [re, label] of SWALLOW) {
        if (re.test(line) && !ALLOWED.get(file)?.has(i + 1))
          hits.push(`${file}:${i + 1} ${label}: ${line.trim()}`);
      }
    });
    assert.deepEqual(hits, []);
  });
}

test('ci.yml uploads pending visual captures as one per-run, per-shard artifact', () => {
  const text = readFileSync(new URL('ci.yml', dir), 'utf8');
  const steps = text.split(/\r?\n(?=\s{6}- name: )/u);
  const compare = steps.find((s) => /--pending\b/u.test(s));
  assert.ok(compare, 'a step runs visual-compare-prototype.mjs --pending');
  assert.match(compare, /visual-compare-prototype\.mjs/u);
  assert.match(compare, /if: always\(\) && .*pending/u);
  // Per shard: compare and upload only when this shard captured pending views.
  assert.match(compare, /steps\.visual-pending\.outputs\.ids != ''/u);
  assert.match(
    compare,
    /--ids "\$\{\{ steps\.visual-pending\.outputs\.ids \}\}"/u,
  );
  const upload = steps.find((s) => /name: visual-pending-/u.test(s));
  assert.ok(upload, 'an upload step names the artifact visual-pending-*');
  assert.match(
    upload,
    /name: visual-pending-\$\{\{ github\.run_id \}\}-shard-\$\{\{ matrix\.shard \}\}/u,
  );
  assert.match(upload, /retention-days: 30/u);
  assert.match(upload, /if-no-files-found: error/u);
  assert.match(upload, /if: always\(\) && .*pending/u);
  assert.match(upload, /steps\.visual-pending\.outputs\.ids != ''/u);
  // Overall, merge-e2e fails when pending views exist and no shard captured them.
  const merge = text.slice(text.indexOf('\n  merge-e2e:'));
  assert.match(
    merge,
    /pattern: visual-pending-\$\{\{ github\.run_id \}\}-shard-\*/u,
  );
  assert.match(merge, /Every pending view was captured by some shard/u);
  assert.match(merge, /process\.exit\(1\)/u);
  assert.match(
    upload,
    /upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u,
  );
  assert.match(upload, /results\.json/u);
  assert.match(upload, /pending\.txt/u);
  assert.doesNotMatch(upload + compare, /continue-on-error/u);
});

function jobBlock(text, name) {
  const match = new RegExp(
    `^  ${name}:\\r?\\n([\\s\\S]*?)(?=^  [\\w-]+:\\r?\\n|(?![\\s\\S]))`,
    'mu',
  ).exec(text);
  assert.ok(match, `ci.yml defines the ${name} job`);
  return match[1];
}

const ci = () => readFileSync(new URL('ci.yml', dir), 'utf8');
const stepBlocks = (job) => job.split(/\r?\n(?=\s{6}- (?:name|uses|run): )/u);

test('compose-e2e uses a 3-shard matrix with fail-fast false', () => {
  const job = jobBlock(ci(), 'compose-e2e');
  assert.match(job, /strategy:\s*\n\s+fail-fast: false/u);
  assert.match(job, /matrix:\s*\n\s+shard: \[1, 2, 3\]/u);
  assert.match(
    job,
    /LEXON_E2E_PROJECT: lexon-e2e-\$\{\{ github\.run_id \}\}-\$\{\{ matrix\.shard \}\}/u,
  );
  assert.match(job, /--shard=\$\{\{ matrix\.shard \}\}\/3/u);
  assert.match(job, /--reporter=blob/u);
  assert.doesNotMatch(job, /--shard=\d/u);
});

test('each shard uploads blob-report and visual artifacts with names containing run_id and shard, retention-days 30 for compare/contact-sheets', () => {
  const steps = stepBlocks(jobBlock(ci(), 'compose-e2e'));
  const pin =
    /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4/u;
  const blob = steps.find((s) => /name: blob-/u.test(s));
  assert.ok(blob, 'a step uploads blob-*');
  assert.match(blob, pin);
  assert.match(
    blob,
    /name: blob-\$\{\{ github\.run_id \}\}-\$\{\{ matrix\.shard \}\}/u,
  );
  assert.match(blob, /path: blob-report/u);
  assert.match(blob, /if: always\(\)/u);
  const compare = steps.find((s) => /name: visual-compare-/u.test(s));
  assert.ok(compare, 'a step uploads visual-compare-*');
  assert.match(compare, pin);
  assert.match(
    compare,
    /name: visual-compare-\$\{\{ github\.run_id \}\}-shard-\$\{\{ matrix\.shard \}\}/u,
  );
  assert.match(compare, /compare\/\*/u);
  assert.match(compare, /contact-sheets\/\*/u);
  assert.match(compare, /retention-days: 30/u);
  assert.match(compare, /if: always\(\)/u);
  for (const s of steps.filter((x) => /upload-artifact@/u.test(x)))
    assert.match(
      s,
      /name: [^\n]*github\.(?:run_id|sha)[^\n]*matrix\.shard/u,
      'every shard artifact name carries the run and the shard',
    );
});

test('merge-e2e depends on all shards and runs merge-reports', () => {
  const job = jobBlock(ci(), 'merge-e2e');
  assert.match(job, /needs: compose-e2e/u);
  assert.match(job, /actions\/download-artifact@[0-9a-f]{40} # v4/u);
  assert.match(job, /pattern: blob-\*/u);
  assert.match(job, /merge-multiple: true/u);
  assert.match(job, /npx playwright merge-reports --reporter html \.\/blob/u);
});

test('visual-assemble finishes capture and update runs from every shard', () => {
  const job = jobBlock(ci(), 'visual-assemble');
  assert.match(job, /needs: compose-e2e/u);
  assert.match(job, /inputs\.visual_mode != 'compare'/u);
  assert.match(job, /merge-multiple: true/u);
  assert.match(job, /write-visual-baseline-manifest\.mjs/u);
  assert.match(job, /visual-capture-manifest\.mjs/u);
});

test('no job uses continue-on-error', () => {
  assert.doesNotMatch(ci(), /continue-on-error/u);
});
