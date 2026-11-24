import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
// B-14: these variables reach runtime code only through the Zod-validated
// config in backend/src/config/; testing fixtures may still build fake envs.
// Covers dot access, bracket access and object destructuring.
const names =
  '(?:OPENROUTER_API_KEY|LEXON_OPENROUTER_ZDR_ONLY_VERIFIED|LEXON_OTEL_COLLECTOR_URL)';
const banned = new RegExp(
  String.raw`process\.env\.${names}\b|process\.env\s*\[\s*['"]${names}['"]|\{\s*[^}]*\b${names}\b[^}]*\}\s*=\s*process\.env`,
  'u',
);

test('provider and telemetry env vars are read only inside backend/src/config', () => {
  const offenders = [];
  for (const file of globSync('backend/src/**/*.ts', { cwd: root })) {
    if (file.startsWith('backend/src/config/')) continue;
    if (file.split('/').includes('testing')) continue;
    const source = readFileSync(new URL(file, root), 'utf8');
    source.split('\n').forEach((line, index) => {
      if (banned.test(line)) offenders.push(`${file}:${index + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
