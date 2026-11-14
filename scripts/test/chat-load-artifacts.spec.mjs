import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const preloadPath = join(
  root,
  'scripts/test/fixtures/chat-load-e2e-preload.mjs',
);
const reportNames = ['F4-sse-load.json', 'F4-stream-latency.json'];

const syntheticEnvironment = {
  POSTGRES_ADMIN_PASSWORD: 'synthetic-postgres-admin-password',
  DATABASE_MIGRATOR_PASSWORD: 'synthetic-migrator-password',
  DATABASE_APP_PASSWORD: 'synthetic-app-password',
  DATABASE_AUTH_PASSWORD: 'synthetic-auth-database-password',
  DATABASE_SETUP_PASSWORD: 'synthetic-setup-password',
  AUTH_SECRET: 'synthetic-auth-secret',
  AUTH_AUDIT_HMAC_SECRET: 'synthetic-audit-secret',
  SMTP_URL: 'smtp://127.0.0.1:2525',
  SMTP_FROM: 'lexon@example.test',
  VALKEY_PASSWORD: 'synthetic-valkey-password',
  S3_ACCESS_KEY: 'synthetic-s3-access-key',
  S3_SECRET_KEY: 'synthetic-s3-secret-key',
  S3_BUCKET: 'lexon-e2e-test',
};

async function runE2E({ load = true, playwrightExit = 0, stale = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'chat-load-artifacts-'));
  const binDirectory = join(directory, 'bin');
  const evidenceDirectory = join(directory, 'evidence');
  const eventLog = join(directory, 'events.jsonl');
  const dockerLog = join(directory, 'docker.jsonl');
  await mkdir(binDirectory, { recursive: true });
  await mkdir(evidenceDirectory, { recursive: true });
  if (stale) {
    for (const name of reportNames)
      await writeFile(join(evidenceDirectory, name), '{"passed":true}');
  }
  const fakeDocker = String.raw`#!${process.execPath}
import { appendFileSync, readdirSync } from 'node:fs';
const args = process.argv.slice(2);
const evidence = process.env.LEXON_CHAT_LOAD_EVIDENCE_DIR;
const reports = ['F4-sse-load.json', 'F4-stream-latency.json'];
const beforeDown = args.includes('down')
  ? readdirSync(evidence).filter((name) => reports.includes(name))
  : [];
appendFileSync(process.env.CHAT_LOAD_TEST_DOCKER_LOG, JSON.stringify({ args, beforeDown }) + '\n');
if (process.env.LEXON_CHAT_LOAD === '1' && beforeDown.length)
  process.exitCode = 27;
`;
  await writeFile(join(binDirectory, 'docker'), fakeDocker, { mode: 0o755 });

  try {
    const child = spawnSync(
      process.execPath,
      [
        join(root, 'scripts/e2e.mjs'),
        ...(load ? ['--project', 'chat-sse-load'] : []),
      ],
      {
        cwd: root,
        encoding: 'utf8',
        timeout: 45_000,
        env: {
          ...syntheticEnvironment,
          PATH: `${binDirectory}:/usr/bin:/bin:/usr/local/bin`,
          NODE_OPTIONS: `--import=${preloadPath}`,
          CHAT_LOAD_TEST_DOCKER_LOG: dockerLog,
          CHAT_LOAD_TEST_EVENT_LOG: eventLog,
          CHAT_LOAD_TEST_PLAYWRIGHT_EXIT: String(playwrightExit),
          LEXON_CHAT_LOAD_EVIDENCE_DIR: evidenceDirectory,
          COMPOSE_DISABLE_ENV_FILE: 'true',
          ...(load
            ? {
                LEXON_CHAT_LOAD: '1',
              }
            : {}),
        },
      },
    );
    const evidenceFiles = await readdir(evidenceDirectory);
    const evidence = Object.fromEntries(
      await Promise.all(
        evidenceFiles.map(async (name) => [
          name,
          await readFile(join(evidenceDirectory, name), 'utf8'),
        ]),
      ),
    );
    const events = await readJsonLines(eventLog);
    const dockerCalls = await readJsonLines(dockerLog);
    const observationDirectory = events[0]?.observationPath
      ? dirname(events[0].observationPath)
      : undefined;
    const stackDirectoryExists = observationDirectory
      ? existsSync(observationDirectory)
      : false;
    return {
      child,
      evidenceFiles,
      evidence,
      events,
      dockerCalls,
      observationDirectory,
      stackDirectoryExists,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function readJsonLines(path) {
  try {
    return (await readFile(path, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

test('successful load E2E publishes validated reports after stack teardown', async () => {
  const result = await runE2E();

  assert.equal(result.child.status, 0, result.child.stderr);
  assert.deepEqual(result.evidenceFiles.sort(), reportNames);
  assert.equal(JSON.parse(result.evidence['F4-sse-load.json']).passed, true);
  assert.equal(
    JSON.parse(result.evidence['F4-stream-latency.json']).measurement,
    'mock-send-to-first-frame',
  );
  assert.ok(result.events.some((event) => event.event === 'playwright'));
  const down = result.dockerCalls.find((call) => call.args.includes('down'));
  assert.ok(down, 'owned stack was not torn down');
  assert.deepEqual(down.beforeDown, []);
  assert.ok(result.observationDirectory);
  assert.equal(result.stackDirectoryExists, false);
  assert.doesNotMatch(
    result.evidence['F4-sse-load.json'] +
      result.evidence['F4-stream-latency.json'],
    /cookie|ownerId|runId|privatePrompt/u,
  );
});

test('failed Playwright load never publishes passing aggregate reports', async () => {
  const result = await runE2E({ playwrightExit: 1 });

  assert.notEqual(result.child.status, 0);
  assert.ok(result.events.some((event) => event.event === 'playwright'));
  assert.deepEqual(result.evidenceFiles, []);
});

test('normal E2E leaves load evidence output untouched', async () => {
  const result = await runE2E({ load: false, stale: true });

  assert.equal(result.child.status, 0, result.child.stderr);
  assert.deepEqual(result.evidenceFiles.sort(), reportNames);
  assert.deepEqual(result.evidence, {
    'F4-sse-load.json': '{"passed":true}',
    'F4-stream-latency.json': '{"passed":true}',
  });
  assert.deepEqual(result.events, []);
});
