import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { GenericContainer, Wait } from 'testcontainers';
import { readContainerImages } from '../../../../../scripts/container-images.mjs';
import {
  bootstrapDatabase,
  configureRuntimeRolePasswords,
  dropDatabase,
  migrateDatabase,
  roleUrl,
} from './provision.js';

export interface EvaluationServices {
  readonly postgresUrl: string;
  readonly valkeyUrl: string;
  readonly seaweedS3Url: string;
}

export function createSeaweedS3Config(
  accessKey: string,
  secretKey: string,
): string {
  return JSON.stringify({
    identities: [
      {
        name: 'test',
        credentials: [{ accessKey, secretKey }],
        actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
      },
    ],
  });
}

interface InfrastructureDescriptor {
  readonly runId: string;
  readonly adminUrl: string;
  readonly template: string;
  readonly passwords: { migrator: string; app: string; auth: string };
  readonly valkeyUrl: string;
  readonly s3: { endpoint: string };
}

type Acquisition = () => Promise<{
  descriptor: EvaluationServices;
  release(): Promise<void>;
}>;

interface SharedInfrastructureState {
  shared: Promise<Awaited<ReturnType<Acquisition>>> | undefined;
  references: number;
  stopped: Promise<void> | undefined;
}

const sharedStateKey = Symbol.for('lexon.shared-test-infrastructure.v1');
const globalState = globalThis as typeof globalThis & {
  [key: symbol]: SharedInfrastructureState | undefined;
};
const state = (globalState[sharedStateKey] ??= {
  references: 0,
  shared: undefined,
  stopped: undefined,
});

/** Acquire one process-wide Testcontainers stack and release it after all projects. */
export async function acquireTestInfrastructure(
  acquire: Acquisition = startInfrastructure,
): Promise<{ descriptor: EvaluationServices; release(): Promise<void> }> {
  if (!state.shared) {
    state.stopped = undefined;
    state.shared = acquire().catch((error: unknown) => {
      state.shared = undefined;
      throw error;
    });
  }
  const acquisition = await state.shared;
  state.references += 1;
  let released = false;
  return {
    descriptor: acquisition.descriptor,
    async release() {
      if (released) return;
      released = true;
      state.references -= 1;
      if (state.references === 0) {
        state.stopped ??= acquisition.release();
        await state.stopped;
        state.shared = undefined;
        state.stopped = undefined;
      }
    },
  };
}

async function startInfrastructure(): Promise<{
  descriptor: EvaluationServices;
  release(): Promise<void>;
}> {
  await promisify(execFile)(
    process.execPath,
    [
      new URL('../../../../../node_modules/typescript/bin/tsc', import.meta.url)
        .pathname,
      '-p',
      new URL('../../../../test/process/tsconfig.json', import.meta.url)
        .pathname,
    ],
    { timeout: 30000 },
  );
  await cp(
    new URL('../../../../config/', import.meta.url),
    new URL('../../../../.test-build/config/', import.meta.url),
    { recursive: true },
  );
  const reuse = process.env.LEXON_TEST_REUSE === '1';
  if (reuse && process.env.CI)
    throw new Error('Container reuse is forbidden in CI');
  const images = readContainerImages(
    new URL('../../../../../config/container-images.env', import.meta.url)
      .pathname,
  );
  let password = randomBytes(24).toString('hex');
  if (reuse) {
    const path = new URL(
      '../../../../../.cache/testcontainers-local-secret',
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
  const cleanups: (() => Promise<unknown>)[] = [];
  let ready = false;
  const container = (image: string) => {
    const config = new GenericContainer(image);
    return reuse ? config.withReuse() : config;
  };
  try {
    const pg = await container(images.postgres)
      .withEnvironment({ POSTGRES_PASSWORD: password })
      .withExposedPorts(5432)
      .withWaitStrategy(
        Wait.forLogMessage('database system is ready to accept connections', 2),
      )
      .withStartupTimeout(120000)
      .start();
    cleanups.push(() => (ready && reuse ? Promise.resolve() : pg.stop()));
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
    cleanups.push(() => (ready && reuse ? Promise.resolve() : valkey.stop()));
    const seaweed = await container(images.seaweedfs)
      .withCopyContentToContainer([
        {
          content: createSeaweedS3Config('lexon-local-test', password),
          target: '/etc/lexon-s3.json',
        },
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
    cleanups.push(() => (ready && reuse ? Promise.resolve() : seaweed.stop()));
    const adminUrl = `postgresql://postgres:${password}@${pg.getHost()}:${pg.getMappedPort(5432)}/postgres`;
    await bootstrapDatabase({
      adminUrl,
      databaseName: template,
      migratorPassword: password,
    });
    cleanups.push(() => dropDatabase(adminUrl, template));
    const migratorUrl = roleUrl(adminUrl, 'lexon_migrator', password, template);
    await migrateDatabase(migratorUrl);
    await configureRuntimeRolePasswords(migratorUrl, {
      appPassword: password,
      authPassword: password,
    });
    ready = true;
    const descriptor: InfrastructureDescriptor = {
      runId,
      adminUrl,
      template,
      passwords: { migrator: password, app: password, auth: password },
      valkeyUrl: `redis://:${password}@${valkey.getHost()}:${valkey.getMappedPort(6379)}/0`,
      s3: {
        endpoint: `http://${seaweed.getHost()}:${seaweed.getMappedPort(8333)}`,
      },
    };
    const release = async () => {
      for (const cleanup of cleanups.reverse()) {
        try {
          await cleanup();
        } catch {
          // Finish releasing every resource even if one cleanup fails.
        }
      }
    };
    return {
      descriptor: {
        postgresUrl: roleUrl(
          descriptor.adminUrl,
          'postgres',
          password,
          descriptor.template,
        ),
        valkeyUrl: descriptor.valkeyUrl,
        seaweedS3Url: descriptor.s3.endpoint,
      },
      release,
    };
  } catch {
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch {
        // Finish releasing every acquired container after startup failure.
      }
    }
    throw new Error(
      'Integration infrastructure setup failed; check Docker availability, pinned images and migration permissions',
    );
  }
}
