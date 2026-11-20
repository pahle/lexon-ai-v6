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

test('ci.yml uploads pending visual captures as one per-run artifact', () => {
  const text = readFileSync(new URL('ci.yml', dir), 'utf8');
  const steps = text.split(/\r?\n(?=\s{6}- name: )/u);
  const compare = steps.find((s) => /--pending\b/u.test(s));
  assert.ok(compare, 'a step runs visual-compare-prototype.mjs --pending');
  assert.match(compare, /visual-compare-prototype\.mjs/u);
  assert.match(compare, /if: always\(\) && .*pending/u);
  const upload = steps.find((s) => /name: visual-pending-/u.test(s));
  assert.ok(upload, 'an upload step names the artifact visual-pending-*');
  assert.match(upload, /name: visual-pending-\$\{\{ github\.run_id \}\}/u);
  assert.match(upload, /retention-days: 30/u);
  assert.match(upload, /if-no-files-found: error/u);
  assert.match(upload, /if: always\(\) && .*pending/u);
  assert.match(
    upload,
    /upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/u,
  );
  assert.match(upload, /results\.json/u);
  assert.match(upload, /pending\.txt/u);
  assert.doesNotMatch(upload + compare, /continue-on-error/u);
});
