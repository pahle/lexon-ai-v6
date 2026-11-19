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
