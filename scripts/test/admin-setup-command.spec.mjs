import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const command = new URL(
  '../../backend/dist/entrypoints/admin-setup/main.js',
  import.meta.url,
);
test('operator CLI rejects unknown flags with bounded output and no sensitive arguments', () => {
  const secret = 'never-print-this@example.test';
  const result = spawnSync(
    process.execPath,
    [command.pathname, '--email', secret, '--role', 'admin'],
    { encoding: 'utf8', env: { PATH: process.env.PATH } },
  );
  assert.equal(result.status, 2);
  assert.equal(result.stderr.trim(), 'Invalid setup arguments');
  assert.ok(!result.stderr.includes(secret));
  assert.equal(result.stdout, '');
});
