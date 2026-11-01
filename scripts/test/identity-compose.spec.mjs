import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { composeEnvironment } from '../compose-environment.mjs';
import { composeArgs } from '../compose-runner.mjs';
import { readContainerImages } from '../container-images.mjs';
test('identity Compose secrets are API/operator-only and Mailpit is optional ephemeral loopback development mail', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-identity-compose-'));
  try {
    const input = Object.fromEntries(
      [
        'POSTGRES_ADMIN_PASSWORD',
        'DATABASE_MIGRATOR_PASSWORD',
        'DATABASE_APP_PASSWORD',
        'DATABASE_AUTH_PASSWORD',
        'DATABASE_SETUP_PASSWORD',
        'VALKEY_PASSWORD',
        'S3_ACCESS_KEY',
        'S3_SECRET_KEY',
        'S3_BUCKET',
        'AUTH_SECRET',
        'AUTH_AUDIT_HMAC_SECRET',
      ].map((name) => [name, 'test-only-' + name]),
    );
    Object.assign(input, {
      AUTH_PUBLIC_ORIGIN: 'http://localhost:3000',
      AUTH_LOCAL_DEVELOPMENT: 'true',
      AUTH_AUDIT_HMAC_KEY_ID: 'test-v1',
      SMTP_URL: 'smtp://mailpit:1025',
      SMTP_FROM: 'lexon@example.test',
    });
    const env = await composeEnvironment(input, directory);
    const rendered = await promisify(execFile)(
      'docker',
      composeArgs('lexon-dev', [
        '--profile',
        'dev-mail',
        '--profile',
        'operator',
        'config',
        '--format',
        'json',
      ]),
      { env: { ...process.env, ...env } },
    );
    const config = JSON.parse(rendered.stdout);
    const mail = config.services.mailpit;
    assert.equal(
      mail.image,
      readContainerImages('config/container-images.env').mailpit,
    );
    assert.deepEqual(mail.profiles, ['dev-mail']);
    assert.equal(mail.ports.length, 1);
    assert.equal(mail.ports[0].host_ip, '127.0.0.1');
    assert.equal(mail.ports[0].target, 8025);
    assert.ok(mail.tmpfs.length);
    assert.deepEqual(Object.keys(mail.networks), ['core']);
    assert.equal(mail.environment.MP_DISABLE_VERSION_CHECK, 'true');
    assert.ok(
      !Object.keys(mail.environment).some((key) => /RELAY|FORWARD/.test(key)),
    );
    for (const name of [
      'ai-worker',
      'document-worker',
      'dispatcher',
      'frontend',
    ])
      assert.ok(
        !Object.keys(config.services[name].environment ?? {}).some((key) =>
          /^(AUTH_|DATABASE_AUTH_|LEXON_SETUP_|SMTP_)/.test(key),
        ),
        name,
      );
    assert.equal(
      config.services.api.environment.DATABASE_AUTH_URL,
      env.DATABASE_AUTH_URL,
    );
    assert.ok(!config.services.api.environment.LEXON_SETUP_DATABASE_URL);
    assert.deepEqual(config.services['admin-setup'].profiles, ['operator']);
    assert.ok(
      config.services['admin-setup'].environment.LEXON_SETUP_DATABASE_URL,
    );
    assert.ok(!config.services['admin-setup'].ports);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
