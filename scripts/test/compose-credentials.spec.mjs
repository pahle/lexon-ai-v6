import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeEnvironment } from '../compose-environment.mjs';
test('SeaweedFS credentials remain host-private and readable after privilege drop', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-credentials-'));
  try {
    const input = Object.fromEntries(
      [
        'POSTGRES_ADMIN_PASSWORD',
        'DATABASE_MIGRATOR_PASSWORD',
        'DATABASE_APP_PASSWORD',
        'DATABASE_AUTH_PASSWORD',
        'VALKEY_PASSWORD',
        'S3_ACCESS_KEY',
        'S3_SECRET_KEY',
        'S3_BUCKET',
      ].map((key) => [key, 'test-value']),
    );
    const env = await composeEnvironment(input, directory);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(env.S3_CONFIG_PATH)).mode & 0o777, 0o444);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
