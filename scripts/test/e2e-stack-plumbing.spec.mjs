import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  buildStackDescriptor,
  stackComposeFiles,
} from '../../backend/test/e2e/compose-files.mjs';
import { stackProblems } from '../e2e-stack-guard.mjs';
import { acquireLock } from '../visual-capture-lock.mjs';

const root = '/repo/';
const identity = `${root}backend/test/e2e/compose.identity.yml`;
const proof = `${root}backend/test/e2e/compose.chat-runtime-proof.yml`;

test('the descriptor carries the compose files the stack started with', () => {
  const stack = buildStackDescriptor({
    project: 'lexon-e2e-ab12',
    operatorEnvironmentPath: '/tmp/env.json',
    apiUrl: 'http://127.0.0.1:1',
    publicUrl: 'http://127.0.0.1:2',
    composeFiles: [identity, proof],
  });
  assert.deepEqual(stack.composeFiles, [identity, proof]);
  assert.equal(stack.frontendUrl, stack.publicUrl);
});

test('test helpers recreate with the full file list, the base file first', () => {
  assert.deepEqual(
    stackComposeFiles({ composeFiles: [identity, proof] }, root),
    [`${root}docker-compose.yml`, identity, proof],
  );
});

test('without a file list in the descriptor the helper falls back to identity', () => {
  assert.deepEqual(stackComposeFiles({}, root), [
    `${root}docker-compose.yml`,
    identity,
  ]);
});

const healthy = {
  composeFiles: [identity, proof],
  api: {
    running: true,
    env: ['AUTH_OPEN_SIGNUP=true'],
    cmd: ['node', 'backend/test/e2e/auth-api-main.mjs'],
  },
  aiWorker: {
    running: true,
    env: [],
    cmd: ['node', 'backend/test/e2e/chat-worker-main.mjs'],
  },
  frontend: { running: true, env: ['NODE_ENV=production'], cmd: [] },
};

test('guard accepts a stack with sign-up open and its overlays', () => {
  assert.deepEqual(stackProblems(healthy), []);
});

test('guard names closed sign-up', () => {
  const problems = stackProblems({
    ...healthy,
    api: { ...healthy.api, env: ['AUTH_OPEN_SIGNUP=false'] },
  });
  assert.match(problems.join('\n'), /AUTH_OPEN_SIGNUP=false/);
});

test('guard names a lost chat-runtime-proof overlay', () => {
  const problems = stackProblems({
    ...healthy,
    aiWorker: { running: true, env: [], cmd: ['node', 'backend/dist/main.js'] },
  });
  assert.match(problems.join('\n'), /chat-runtime-proof/);
});

test('guard names a lost identity overlay and a stopped api', () => {
  const lost = stackProblems({
    ...healthy,
    api: {
      running: true,
      env: ['AUTH_OPEN_SIGNUP=true'],
      cmd: ['node', 'x.js'],
    },
  });
  assert.match(lost.join('\n'), /identity/);
  const stopped = stackProblems({
    ...healthy,
    api: { ...healthy.api, running: false },
  });
  assert.match(stopped.join('\n'), /not running/);
});

test('guard does not demand the proof overlay when the stack has none', () => {
  assert.deepEqual(
    stackProblems({
      ...healthy,
      composeFiles: [identity],
      aiWorker: {
        running: true,
        env: [],
        cmd: ['node', 'backend/dist/main.js'],
      },
    }),
    [],
  );
});

test('guard rejects a dev-server frontend', () => {
  const problems = stackProblems({
    ...healthy,
    frontend: { running: true, env: ['LEXON_VISUAL_DEV=1'], cmd: [] },
  });
  assert.match(problems.join('\n'), /visual-dev/);
});

test('capture lock is exclusive and reclaimed from a dead pid', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lock-'));
  try {
    const file = join(directory, 'capture.lock');
    const dead = spawnSync(process.execPath, ['-e', '0']).pid;
    await writeFile(file, String(dead));
    const release = await acquireLock(file, { pollMs: 10 });
    assert.equal(await readFile(file, 'utf8'), String(process.pid));
    let second = false;
    const waiting = acquireLock(file, {
      pollMs: 10,
      isAlive: (pid) => pid === process.pid,
    }).then((release2) => {
      second = true;
      return release2;
    });
    await new Promise((done) => setTimeout(done, 80));
    assert.equal(second, false);
    await release();
    const release2 = await waiting;
    assert.equal(await readFile(file, 'utf8'), String(process.pid));
    await release2();
    await assert.rejects(readFile(file, 'utf8'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
