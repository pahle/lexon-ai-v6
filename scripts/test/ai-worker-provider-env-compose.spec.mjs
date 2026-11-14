import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { composeEnvironment } from '../compose-environment.mjs';
import { composeArgs } from '../compose-runner.mjs';

const syntheticRequiredEnvironment = {
  POSTGRES_ADMIN_PASSWORD: 'test-only-admin-password',
  DATABASE_MIGRATOR_PASSWORD: 'test-only-migrator-password',
  DATABASE_APP_PASSWORD: 'test-only-app-password',
  DATABASE_AUTH_PASSWORD: 'test-only-auth-password',
  DATABASE_SETUP_PASSWORD: 'test-only-setup-password',
  VALKEY_PASSWORD: 'test-only-valkey-password',
  S3_ACCESS_KEY: 'test-only-s3-access-key',
  S3_SECRET_KEY: 'test-only-s3-secret-key',
  S3_BUCKET: 'test-only-bucket',
  AUTH_SECRET: 'test-only-auth-secret',
  AUTH_AUDIT_HMAC_SECRET: 'test-only-audit-secret',
  SMTP_URL: 'smtp://mailpit:1025',
  SMTP_FROM: 'lexon@example.test',
};

async function renderComposeServices(input, directory) {
  const env = await composeEnvironment(input, directory);
  const args = composeArgs('lexon-dev', ['config', '--format', 'json']);

  let rendered;
  try {
    ({ stdout: rendered } = await promisify(execFile)('docker', args, {
      env: {
        ...env,
        COMPOSE_DISABLE_ENV_FILE: 'true',
        PATH: process.env.PATH,
      },
      maxBuffer: 4 * 1024 * 1024,
    }));
  } catch {
    throw new Error('Docker Compose configuration rendering failed');
  }

  return JSON.parse(rendered).services;
}

test('OpenRouter provider configuration is mapped only to ai-worker', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-ai-worker-compose-'));
  try {
    const services = await renderComposeServices(
      {
        ...syntheticRequiredEnvironment,
        OPENROUTER_API_KEY: 'synthetic-openrouter-key-not-a-secret',
        LEXON_OPENROUTER_ZDR_ONLY_VERIFIED: '2099-01-01',
      },
      directory,
    );
    const workerEnvironment = services['ai-worker'].environment ?? {};

    assert.equal(
      workerEnvironment.OPENROUTER_API_KEY ===
        'synthetic-openrouter-key-not-a-secret',
      true,
      'ai-worker receives the configured provider key',
    );
    assert.equal(
      workerEnvironment.LEXON_OPENROUTER_ZDR_ONLY_VERIFIED === '2099-01-01',
      true,
      'ai-worker receives the configured ZDR verification date',
    );

    for (const [serviceName, service] of Object.entries(services)) {
      if (serviceName === 'ai-worker') continue;
      const environment = service.environment ?? {};
      assert.equal(
        Object.hasOwn(environment, 'OPENROUTER_API_KEY'),
        false,
        `${serviceName} does not receive the provider key`,
      );
      assert.equal(
        Object.hasOwn(environment, 'LEXON_OPENROUTER_ZDR_ONLY_VERIFIED'),
        false,
        `${serviceName} does not receive the ZDR verification date`,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('unset OpenRouter provider configuration has safe empty ai-worker defaults', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-ai-worker-compose-'));
  try {
    const services = await renderComposeServices(
      syntheticRequiredEnvironment,
      directory,
    );
    const workerEnvironment = services['ai-worker'].environment ?? {};

    for (const name of [
      'OPENROUTER_API_KEY',
      'LEXON_OPENROUTER_ZDR_ONLY_VERIFIED',
    ]) {
      assert.equal(
        Object.hasOwn(workerEnvironment, name),
        true,
        `${name} is mapped`,
      );
      assert.equal(
        workerEnvironment[name] === '',
        true,
        `${name} defaults empty`,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
