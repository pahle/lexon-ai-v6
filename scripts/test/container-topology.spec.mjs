import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { composeEnvironment } from '../compose-environment.mjs';
import { composeArgs } from '../compose-runner.mjs';
import { readContainerImages } from '../container-images.mjs';
test('rendered Compose shares image pins, preserves topology and scopes secrets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-compose-contract-'));
  try {
    const env = await composeEnvironment(
      Object.fromEntries(
        [
          'POSTGRES_ADMIN_PASSWORD',
          'DATABASE_MIGRATOR_PASSWORD',
          'DATABASE_APP_PASSWORD',
          'DATABASE_AUTH_PASSWORD',
          'VALKEY_PASSWORD',
          'S3_ACCESS_KEY',
          'S3_SECRET_KEY',
          'S3_BUCKET',
        ].map((key) => [key, 'test-only-' + key]),
      ),
      directory,
    );
    const images = readContainerImages('config/container-images.env');
    const output = await promisify(execFile)(
      'docker',
      composeArgs('lexon-dev', ['config', '--format', 'json']),
      { env: { ...process.env, ...env } },
    );
    const config = JSON.parse(output.stdout);
    const services = config.services;
    for (const key of ['postgres', 'valkey', 'seaweedfs'])
      assert.equal(services[key].image, images[key]);
    assert.notEqual(config.networks.edge.internal, true);
    assert.equal(config.networks.core.internal, true);
    assert.equal(config.networks.sandbox.internal, true);
    assert.deepEqual(Object.keys(services.frontend.networks), ['edge']);
    assert.deepEqual(Object.keys(services['document-worker'].networks).sort(), [
      'core',
      'sandbox',
    ]);
    for (const service of Object.values(services)) {
      assert.ok(service.mem_limit > 0);
      assert.ok(service.cpus > 0);
    }
    for (const service of [
      'api',
      'ai-worker',
      'document-worker',
      'dispatcher',
    ]) {
      assert.equal(services[service].build.args.NODE_IMAGE, images.node);
      assert.ok(
        services[service].tmpfs.some((mount) =>
          mount.startsWith('/run/lexon/health:'),
        ),
      );
      assert.equal(services[service].environment.DATABASE_ADMIN_URL, undefined);
      assert.equal(
        services[service].environment.DATABASE_MIGRATOR_URL,
        undefined,
      );
    }
    for (const name of Object.keys(services.frontend.environment))
      assert.doesNotMatch(name, /DATABASE|VALKEY|S3_|API_KEY/);
    assert.equal(services.postgres.ports, undefined);
    assert.equal(services.valkey.ports, undefined);
    assert.equal(services.seaweedfs.ports, undefined);
    const configFile = JSON.parse(await readFile(env.S3_CONFIG_PATH, 'utf8'));
    assert.equal(
      configFile.identities[0].credentials[0].secretKey,
      env.S3_SECRET_KEY,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
