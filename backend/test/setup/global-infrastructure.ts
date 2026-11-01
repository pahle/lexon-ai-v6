import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { GenericContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { readContainerImages } from '../../../scripts/container-images.mjs';
import {
  bootstrapDatabase,
  configureRuntimeRolePasswords,
} from '../../src/infrastructure/db/testing/provision.js';
import { migrateDatabase } from '../../src/infrastructure/db/testing/provision.js';
import {
  dropDatabase,
  roleUrl,
} from '../../src/infrastructure/db/testing/provision.js';
import { allowContainerReuse, provisionRun } from './resource-lifecycle.js';
import type { InfrastructureDescriptor } from './provided-context.js';

export default async function setup(project: TestProject) {
  await promisify(execFile)(
    process.execPath,
    [
      new URL('../../../node_modules/typescript/bin/tsc', import.meta.url)
        .pathname,
      '-p',
      new URL('../process/tsconfig.json', import.meta.url).pathname,
    ],
    { timeout: 30000 },
  );
  await cp(
    new URL('../../config/', import.meta.url),
    new URL('../../.test-build/config/', import.meta.url),
    { recursive: true },
  );
  const reuse = allowContainerReuse(process.env);
  const images = readContainerImages(
    new URL('../../../config/container-images.env', import.meta.url).pathname,
  );
  let password = randomBytes(24).toString('hex');
  if (reuse) {
    const path = new URL(
      '../../../.cache/testcontainers-local-secret',
      import.meta.url,
    );
    await mkdir(dirname(path.pathname), { recursive: true, mode: 0o700 });
    try {
      password = (await readFile(path, 'utf8')).trim();
    } catch {
      await writeFile(path, password, { mode: 0o600, flag: 'wx' });
    }
  }
  const runId = randomBytes(12).toString('hex');
  const template = `lexon_test_${runId}`;
  let ready = false;
  const container = (image: string) => {
    const config = new GenericContainer(image);
    return reuse ? config.withReuse() : config;
  };
  try {
    const run = await provisionRun(async (register) => {
      const pg = await container(images.postgres)
        .withEnvironment({ POSTGRES_PASSWORD: password })
        .withExposedPorts(5432)
        .withWaitStrategy(
          Wait.forLogMessage(
            'database system is ready to accept connections',
            2,
          ),
        )
        .withStartupTimeout(120000)
        .start();
      register(() => (ready && reuse ? Promise.resolve() : pg.stop()));
      const valkey = await container(images.valkey)
        .withCommand([
          'valkey-server',
          '--requirepass',
          password,
          '--maxmemory-policy',
          'noeviction',
          '--appendonly',
          'yes',
          '--appendfsync',
          'everysec',
        ])
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
        .start();
      register(() => (ready && reuse ? Promise.resolve() : valkey.stop()));
      const credentials = {
        accessKeyId: 'lexon-local-test',
        secretAccessKey: password,
      };
      const s3config = JSON.stringify({
        identities: [
          {
            name: 'test',
            credentials: [
              {
                accessKey: credentials.accessKeyId,
                secretKey: credentials.secretAccessKey,
              },
            ],
            actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
          },
        ],
      });
      const seaweed = await container(images.seaweedfs)
        .withCopyContentToContainer([
          { content: s3config, target: '/etc/lexon-s3.json' },
        ])
        .withCommand([
          'server',
          '-s3',
          '-filer',
          '-dir=/data',
          '-ip=127.0.0.1',
          '-ip.bind=0.0.0.0',
          '-master.telemetry=false',
          '-volume.max=64',
          '-master.volumeSizeLimitMB=64',
          '-s3.config=/etc/lexon-s3.json',
        ])
        .withExposedPorts(8333)
        .withWaitStrategy(Wait.forListeningPorts())
        .withStartupTimeout(120000)
        .start();
      register(() => (ready && reuse ? Promise.resolve() : seaweed.stop()));
      const adminUrl = `postgresql://postgres:${password}@${pg.getHost()}:${pg.getMappedPort(5432)}/postgres`;
      await bootstrapDatabase({
        adminUrl,
        databaseName: template,
        migratorPassword: password,
      });
      register(() => dropDatabase(adminUrl, template));
      const migratorUrl = roleUrl(
        adminUrl,
        'lexon_migrator',
        password,
        template,
      );
      await migrateDatabase(migratorUrl);
      await configureRuntimeRolePasswords(migratorUrl, {
        appPassword: password,
        authPassword: password,
      });
      const descriptor: InfrastructureDescriptor = {
        runId,
        adminUrl,
        template,
        passwords: { migrator: password, app: password, auth: password },
        valkeyUrl: `redis://:${password}@${valkey.getHost()}:${valkey.getMappedPort(6379)}/0`,
        s3: {
          endpoint: `http://${seaweed.getHost()}:${seaweed.getMappedPort(8333)}`,
          credentials,
        },
      };
      return descriptor;
    });
    ready = true;
    project.provide('infrastructure', run.value);
    return run.stop;
  } catch {
    throw new Error(
      'Integration infrastructure setup failed; check Docker availability, pinned images and migration permissions',
    );
  }
}
