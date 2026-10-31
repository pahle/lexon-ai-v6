import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('compiled setup commands fail without exposing environment or exception values', () => {
  for (const file of ['db', 'storage']) {
    const sentinel = 'LEXON_SETUP_SECRET_SENTINEL';
    const result = spawnSync(
      process.execPath,
      [
        `backend/dist/infrastructure/${file}/setup-command.js`,
        'invalid-command',
      ],
      {
        encoding: 'utf8',
        env: {
          PATH: process.env.PATH,
          DATABASE_ADMIN_URL: sentinel,
          S3_SECRET_KEY: sentinel,
        },
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stdout, /setup_failed/);
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(sentinel));
  }
});
