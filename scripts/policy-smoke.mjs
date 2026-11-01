import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { composeEnvironment, root } from './compose-environment.mjs';
import { composeArgs, run } from './compose-runner.mjs';
const source = process.argv[2];
if (!/^lexon-e2e-[a-f0-9]+$/.test(source))
  throw new Error('Invalid source E2E project');
const directory = await mkdtemp(join(tmpdir(), 'lexon-policy-'));
const project = 'lexon-e2e-' + randomBytes(8).toString('hex');
const secret = () => randomBytes(24).toString('hex');
const env = await composeEnvironment(
  {
    ...process.env,
    POSTGRES_ADMIN_PASSWORD: secret(),
    DATABASE_MIGRATOR_PASSWORD: secret(),
    DATABASE_APP_PASSWORD: secret(),
    DATABASE_AUTH_PASSWORD: secret(),
    DATABASE_SETUP_PASSWORD: secret(),
    AUTH_SECRET: secret(),
    AUTH_AUDIT_HMAC_SECRET: secret(),
    AUTH_AUDIT_HMAC_KEY_ID: 'policy-v1',
    AUTH_PUBLIC_ORIGIN: 'http://localhost:3000',
    AUTH_LOCAL_DEVELOPMENT: 'true',
    SMTP_URL: 'smtp://127.0.0.1:2525',
    SMTP_FROM: 'lexon@example.test',
    VALKEY_PASSWORD: secret(),
    S3_ACCESS_KEY: secret(),
    S3_SECRET_KEY: secret(),
    S3_BUCKET: 'lexon-policy',
    API_HOST_PORT: '0',
    FRONTEND_HOST_PORT: '0',
  },
  directory,
);
const override = join(directory, 'images.json');
await writeFile(
  override,
  JSON.stringify({
    services: Object.fromEntries(
      [
        'api',
        'ai-worker',
        'document-worker',
        'dispatcher',
        'bootstrap',
        'migrate',
        'storage-bootstrap',
        'frontend',
      ].map((service) => [service, { image: `${source}-${service}:latest` }]),
    ),
  }),
);
const wrong = root + 'backend/test/e2e/compose.wrong-valkey.yml';
const files = [override, wrong];
const controller = new AbortController();
const stop = () => controller.abort();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
const invoke = async (args, extra = {}) =>
  run('docker', composeArgs(project, args, files), {
    env: { ...env, ...extra },
    quiet: true,
    ...(args[0] === 'down' ? {} : { signal: controller.signal }),
  }).catch(() => {
    throw new Error('Policy command failed: ' + args.join(' '));
  });

try {
  await invoke(
    [
      'up',
      '--detach',
      '--no-build',
      'postgres',
      'valkey',
      'seaweedfs',
      'migrate',
      'storage-bootstrap',
    ],
    { TEST_EVICTION_POLICY: 'noeviction' },
  );
  await invoke(['wait', 'migrate', 'storage-bootstrap'], {
    TEST_EVICTION_POLICY: 'noeviction',
  });
  for (const settings of [
    {
      TEST_EVICTION_POLICY: 'allkeys-lru',
      TEST_AOF: 'yes',
      TEST_FSYNC: 'everysec',
    },
    {
      TEST_EVICTION_POLICY: 'noeviction',
      TEST_AOF: 'no',
      TEST_FSYNC: 'everysec',
    },
    {
      TEST_EVICTION_POLICY: 'noeviction',
      TEST_AOF: 'yes',
      TEST_FSYNC: 'always',
    },
  ]) {
    await invoke(
      [
        'up',
        '--detach',
        '--no-build',
        '--force-recreate',
        '--wait',
        '--wait-timeout',
        '30',
        'valkey',
      ],
      settings,
    );
    await invoke(
      ['up', '--detach', '--no-deps', '--no-build', '--force-recreate', 'api'],
      settings,
    );
    const id = (await invoke(['ps', '-aq', 'api'])).trim();
    let exited = false;
    const observedAt = performance.now();
    for (let attempt = 0; attempt < 300; attempt++) {
      const state = JSON.parse(
        await run('docker', ['inspect', '--format', '{{json .State}}', id], {
          quiet: true,
        }),
      );
      if (state.Status === 'exited') {
        if (state.ExitCode !== 1)
          throw new Error('Unexpected API startup exit');
        exited = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    process.stderr.write(
      'API policy rejection observation ms: ' +
        Math.round(performance.now() - observedAt) +
        '\n',
    );
    if (!exited) throw new Error('Unsafe policy did not reject API startup');
  }
  const correct = {
    TEST_EVICTION_POLICY: 'noeviction',
    TEST_AOF: 'yes',
    TEST_FSYNC: 'everysec',
  };
  await invoke(
    [
      'up',
      '--detach',
      '--no-build',
      '--force-recreate',
      '--wait',
      '--wait-timeout',
      '30',
      'valkey',
    ],
    correct,
  );
  await invoke(
    [
      'up',
      '--detach',
      '--no-deps',
      '--no-build',
      '--force-recreate',
      '--wait',
      '--wait-timeout',
      '30',
      'api',
    ],
    correct,
  );
  console.log('Valkey startup rejection and recovery passed');
} finally {
  await invoke([
    'down',
    '--volumes',
    '--remove-orphans',
    '--timeout',
    '12',
  ]).finally(async () => {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    await rm(directory, { recursive: true, force: true });
  });
}
