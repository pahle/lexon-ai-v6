import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
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
        'DATABASE_SETUP_PASSWORD',
        'AUTH_SECRET',
        'AUTH_AUDIT_HMAC_SECRET',
        'SMTP_URL',
        'SMTP_FROM',
        'VALKEY_PASSWORD',
        'S3_ACCESS_KEY',
        'S3_SECRET_KEY',
        'S3_BUCKET',
      ].map((key) => [key, 'test-value']),
    );
    await writeFile(join(directory, 's3.json'), '{}', { mode: 0o600 });
    const env = await composeEnvironment(input, directory);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
    assert.equal((await stat(env.S3_CONFIG_PATH)).mode & 0o777, 0o444);
    await composeEnvironment(input, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
