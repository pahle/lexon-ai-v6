import assert from 'node:assert/strict';
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
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('../..', import.meta.url));
const scriptPath = join(root, 'scripts/chat-load-evidence.mjs');
const contractsBuildArgs = ['exec', 'tsc', '-p', 'shared/tsconfig.build.json'];
const qualificationArgs = [
  'exec',
  'vitest',
  'run',
  '--project',
  'backend-integration',
  'backend/test/integration/chat-sse.spec.ts',
  '-t',
  'the seventh live SSE connection evicts only the oldest socket',
];
const e2eArgs = ['test:e2e', '--project', 'chat-sse-load'];

async function runWithFakePnpm({
  contractsBuildExit = 0,
  qualificationExit,
  e2eExit,
  removeEvidenceOnE2EFailure = false,
}) {
  const directory = await mkdtemp(join(tmpdir(), 'chat-load-command-'));
  const binDirectory = join(directory, 'bin');
  const logPath = join(directory, 'pnpm-calls.jsonl');
  const evidenceDirectory = join(directory, 'evidence');
  await mkdir(binDirectory, { recursive: true });
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    join(evidenceDirectory, 'F4-sse-load.json'),
    '{"passed":true}',
  );
  await writeFile(
    join(evidenceDirectory, 'F4-stream-latency.json'),
    '{"passed":true}',
  );
  await writeFile(
    join(evidenceDirectory, 'diagnostic.json'),
    '{"phase":"old","status":"failed"}',
  );
  const fakePnpm = String.raw`#!${process.execPath}
import { appendFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const record = {
  args,
  loadFlag: process.env.LEXON_CHAT_LOAD ?? null,
  defaultSixQualified: process.env.LEXON_CHAT_DEFAULT_SIX_QUALIFIED ?? null,
  composeEnvFileDisabled: process.env.COMPOSE_DISABLE_ENV_FILE ?? null,
  staleDiagnosticPresent: existsSync(
    join(process.env.LEXON_CHAT_LOAD_EVIDENCE_DIR, 'diagnostic.json'),
  ),
};
appendFileSync(process.env.CHAT_LOAD_TEST_LOG, JSON.stringify(record) + '\n');
const qualification = args[0] === 'exec' && args[1] === 'vitest';
const contractsBuild = args[0] === 'exec' && args[1] === 'tsc';
const e2e = !qualification && !contractsBuild;
if (e2e && process.env.CHAT_LOAD_TEST_REMOVE_EVIDENCE_ON_E2E_FAILURE === '1') {
  rmSync(process.env.LEXON_CHAT_LOAD_EVIDENCE_DIR, { recursive: true, force: true });
}
process.exitCode = Number(
  contractsBuild
    ? process.env.CHAT_LOAD_TEST_CONTRACTS_BUILD_EXIT
    : qualification
      ? process.env.CHAT_LOAD_TEST_QUALIFICATION_EXIT
      : process.env.CHAT_LOAD_TEST_E2E_EXIT,
);
`;
  const pnpmPath = join(binDirectory, 'pnpm');
  await writeFile(pnpmPath, fakePnpm, { mode: 0o755 });

  try {
    const child = spawnSync(process.execPath, [scriptPath], {
      cwd: root,
      encoding: 'utf8',
      env: {
        PATH: binDirectory,
        CHAT_LOAD_TEST_LOG: logPath,
        LEXON_CHAT_LOAD_EVIDENCE_DIR: evidenceDirectory,
        CHAT_LOAD_TEST_CONTRACTS_BUILD_EXIT: String(contractsBuildExit),
        CHAT_LOAD_TEST_QUALIFICATION_EXIT: String(qualificationExit),
        CHAT_LOAD_TEST_E2E_EXIT: String(e2eExit),
        CHAT_LOAD_TEST_REMOVE_EVIDENCE_ON_E2E_FAILURE:
          removeEvidenceOnE2EFailure ? '1' : '0',
      },
    });
    let calls = [];
    try {
      calls = (await readFile(logPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    let evidenceFiles = [];
    try {
      evidenceFiles = await readdir(evidenceDirectory);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    return {
      ...child,
      calls,
      evidenceDirectory,
      evidenceFiles,
      evidence: Object.fromEntries(
        await Promise.all(
          evidenceFiles.map(async (name) => [
            name,
            await readFile(join(evidenceDirectory, name), 'utf8'),
          ]),
        ),
      ),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('root package exposes the chat load command entry point', async () => {
  const packageJson = JSON.parse(
    await readFile(join(root, 'package.json'), 'utf8'),
  );
  assert.equal(
    packageJson.scripts['test:load:chat'],
    'node scripts/chat-load-evidence.mjs',
  );
});

test('failed seventh-connection qualification stops before Compose E2E', async () => {
  const child = await runWithFakePnpm({ qualificationExit: 1, e2eExit: 0 });

  assert.notEqual(child.status, 0);
  assert.deepEqual(
    child.calls.map((call) => call.args),
    [contractsBuildArgs, qualificationArgs],
  );
  assert.equal(child.calls[0].defaultSixQualified, null);
  assert.equal(child.calls[0].staleDiagnosticPresent, false);
  assert.equal(child.calls[1].defaultSixQualified, null);
  assert.equal(child.calls[1].staleDiagnosticPresent, false);
  assert.deepEqual(child.evidenceFiles, ['failure.json']);
  assert.deepEqual(JSON.parse(child.evidence['failure.json']), {
    phase: 'qualification',
    status: 'failed',
  });
});

test('successful qualification launches flagged E2E and propagates E2E failure', async () => {
  const child = await runWithFakePnpm({ qualificationExit: 0, e2eExit: 1 });

  assert.notEqual(child.status, 0);
  assert.deepEqual(
    child.calls.map((call) => call.args),
    [contractsBuildArgs, qualificationArgs, e2eArgs],
  );
  assert.equal(child.calls[0].loadFlag, null);
  assert.equal(child.calls[0].defaultSixQualified, null);
  assert.equal(child.calls[0].composeEnvFileDisabled, null);
  assert.equal(child.calls[0].staleDiagnosticPresent, false);
  assert.equal(child.calls[1].loadFlag, null);
  assert.equal(child.calls[1].defaultSixQualified, null);
  assert.equal(child.calls[1].composeEnvFileDisabled, null);
  assert.equal(child.calls[1].staleDiagnosticPresent, false);
  assert.equal(child.calls[2].loadFlag, '1');
  assert.equal(child.calls[2].defaultSixQualified, '1');
  assert.equal(child.calls[2].composeEnvFileDisabled, 'true');
  assert.equal(child.calls[2].staleDiagnosticPresent, false);
  assert.deepEqual(child.evidenceFiles, ['failure.json']);
  assert.deepEqual(JSON.parse(child.evidence['failure.json']), {
    phase: 'e2e',
    status: 'failed',
  });
});

test('E2E failure recreates its safe failure record after Playwright removes output directory', async () => {
  const child = await runWithFakePnpm({
    qualificationExit: 0,
    e2eExit: 1,
    removeEvidenceOnE2EFailure: true,
  });

  assert.notEqual(child.status, 0);
  assert.deepEqual(
    child.calls.map((call) => call.args),
    [contractsBuildArgs, qualificationArgs, e2eArgs],
  );
  assert.equal(child.calls[0].staleDiagnosticPresent, false);
  assert.equal(child.calls[1].staleDiagnosticPresent, false);
  assert.equal(child.calls[2].staleDiagnosticPresent, false);
  assert.deepEqual(child.evidenceFiles, ['failure.json']);
  assert.deepEqual(JSON.parse(child.evidence['failure.json']), {
    phase: 'e2e',
    status: 'failed',
  });
});

test('shared contracts build failure stops before qualification and Compose E2E', async () => {
  const child = await runWithFakePnpm({
    contractsBuildExit: 1,
    qualificationExit: 0,
    e2eExit: 0,
  });

  assert.notEqual(child.status, 0);
  assert.deepEqual(
    child.calls.map((call) => call.args),
    [contractsBuildArgs],
  );
  assert.equal(child.calls[0].defaultSixQualified, null);
  assert.equal(child.calls[0].staleDiagnosticPresent, false);
  assert.deepEqual(child.evidenceFiles, ['failure.json']);
  assert.deepEqual(JSON.parse(child.evidence['failure.json']), {
    phase: 'qualification',
    status: 'failed',
  });
});

test('actual E2E CLI composes load overlays and cleans up after config failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'chat-load-e2e-cli-'));
  const binDirectory = join(directory, 'bin');
  const logPath = join(directory, 'docker-calls.jsonl');
  await mkdir(binDirectory, { recursive: true });
  const fakeDocker = String.raw`#!${process.execPath}
import { appendFileSync } from 'node:fs';
appendFileSync(
  process.env.CHAT_LOAD_DOCKER_LOG,
  JSON.stringify({
    args: process.argv.slice(2),
    loadFlag: process.env.LEXON_CHAT_LOAD ?? null,
    composeEnvFileDisabled: process.env.COMPOSE_DISABLE_ENV_FILE ?? null,
  }) + '\n',
);
process.exitCode = 1;
`;
  await writeFile(join(binDirectory, 'docker'), fakeDocker, { mode: 0o755 });

  try {
    const child = spawnSync(
      process.execPath,
      [join(root, 'scripts/e2e.mjs'), '--project', 'chat-sse-load'],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          PATH: binDirectory,
          CHAT_LOAD_DOCKER_LOG: logPath,
          LEXON_CHAT_LOAD: '1',
          COMPOSE_DISABLE_ENV_FILE: 'true',
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
        },
      },
    );
    const calls = (await readFile(logPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const [configCall, downCall] = calls;
    const composeArgs = configCall.args;
    const expectedRuntimeOverlay = join(
      root,
      'backend/test/e2e/compose.chat-runtime-proof.yml',
    );
    const expectedLoadOverlay = join(
      root,
      'backend/test/e2e/compose.chat-load.yml',
    );

    assert.notEqual(child.status, 0);
    assert.equal(calls.length, 2);
    assert.equal(composeArgs[0], 'compose');
    assert.equal(composeArgs[1], '--project-name');
    assert.match(composeArgs[2], /^lexon-e2e-[a-f0-9]+$/u);
    assert.ok(
      composeArgs.some(
        (argument, index) =>
          argument === '--file' &&
          composeArgs[index + 1] === expectedRuntimeOverlay,
      ),
    );
    assert.ok(
      composeArgs.some(
        (argument, index) =>
          argument === '--file' &&
          composeArgs[index + 1] === expectedLoadOverlay,
      ),
    );
    assert.deepEqual(composeArgs.slice(-2), ['config', '--quiet']);
    assert.deepEqual(downCall.args.slice(-5), [
      'down',
      '--volumes',
      '--remove-orphans',
      '--timeout',
      '12',
    ]);
    for (const call of calls) {
      assert.equal(call.loadFlag, '1');
      assert.equal(call.composeEnvFileDisabled, 'true');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
