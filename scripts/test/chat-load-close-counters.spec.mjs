import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  CLOSE_ELAPSED_BUCKETS,
  CLOSE_KINDS,
  CLOSE_REASONS,
  closeElapsedBucket,
  createCloseCounters,
} from '../../backend/test/load/close-counters.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('close reason buckets cover the F4.4 diagnosis contract', () => {
  assert.deepEqual([...CLOSE_KINDS].sort(), ['invalidation', 'run']);
  for (const reason of [
    'revoked401',
    'revoked403',
    'revoked404',
    'revokedRenewError',
    'revokedOther',
    'evicted',
    'shutdown',
    'slowClient',
    'clientAbort',
    'normal',
    'otherError',
  ])
    assert.ok(CLOSE_REASONS.includes(reason), `missing ${reason}`);
  assert.equal(CLOSE_ELAPSED_BUCKETS.length >= 4, true);
});

test('elapsed buckets split the ramp from the hold window', () => {
  assert.equal(closeElapsedBucket(0), 'under5s');
  assert.equal(closeElapsedBucket(4_999), 'under5s');
  assert.equal(closeElapsedBucket(5_000), '5to15s');
  assert.equal(closeElapsedBucket(14_999), '5to15s');
  assert.equal(closeElapsedBucket(15_000), '15to30s');
  assert.equal(closeElapsedBucket(30_000), '30to55s');
  assert.equal(closeElapsedBucket(55_000), '55sOrMore');
  assert.equal(closeElapsedBucket(200_000), '55sOrMore');
});

test('a revalidation failure increment the matching revoked cause', () => {
  const counters = createCloseCounters();
  counters.begin(10_000);
  counters.noteRevalidationCloseError(0, '401', 10_200);
  counters.recordClose({
    kind: 'invalidation',
    reason: 'revoked',
    ownerIndex: 0,
    nowMs: 10_300,
  });
  counters.noteRevalidationCloseError(1, '404', 10_400);
  counters.recordClose({
    kind: 'run',
    reason: 'revoked',
    ownerIndex: 1,
    nowMs: 10_500,
  });
  const snapshot = counters.snapshot();
  assert.equal(snapshot.invalidation.revoked401.total, 1);
  assert.equal(snapshot.run.revoked404.total, 1);
  assert.equal(snapshot.invalidation.revoked401.buckets.under5s, 1);
});

test('a null renew increments evicted, a renew rejection revokedRenewError', () => {
  const counters = createCloseCounters();
  counters.begin(10_000);
  counters.recordClose({
    kind: 'run',
    reason: 'evicted',
    ownerIndex: 0,
    nowMs: 20_000,
  });
  counters.noteRenewRejected(1, 30_100);
  counters.recordClose({
    kind: 'run',
    reason: 'revoked',
    ownerIndex: 1,
    nowMs: 30_200,
  });
  const snapshot = counters.snapshot();
  assert.equal(snapshot.run.evicted.total, 1);
  assert.equal(snapshot.run.evicted.buckets['5to15s'], 1);
  assert.equal(snapshot.run.revokedRenewError.total, 1);
  assert.equal(snapshot.run.revokedRenewError.buckets['15to30s'], 1);
});

test('ownership and snapshot misses attribute revoked closes to 404', () => {
  const counters = createCloseCounters();
  counters.begin(0);
  counters.noteOwnershipMissing(0, 100);
  counters.recordClose({
    kind: 'run',
    reason: 'revoked',
    ownerIndex: 0,
    nowMs: 200,
  });
  counters.noteSnapshotMissing(1, 300);
  counters.recordClose({
    kind: 'invalidation',
    reason: 'revoked',
    ownerIndex: 1,
    nowMs: 400,
  });
  const snapshot = counters.snapshot();
  assert.equal(snapshot.run.revoked404.total, 1);
  assert.equal(snapshot.invalidation.revoked404.total, 1);
});

test('a revoked close without a fresh cause is revokedOther', () => {
  const counters = createCloseCounters();
  counters.begin(0);
  counters.recordClose({
    kind: 'run',
    reason: 'revoked',
    ownerIndex: 0,
    nowMs: 100,
  });
  counters.noteRevalidationCloseError(1, '401', 100);
  // The cause is stale by the time the close lands.
  counters.recordClose({
    kind: 'run',
    reason: 'revoked',
    ownerIndex: 1,
    nowMs: 60_000,
  });
  const snapshot = counters.snapshot();
  assert.equal(snapshot.run.revokedOther.total, 2);
  assert.equal(snapshot.run.revoked401, undefined);
});

test('client aborts and the remaining close reasons count per kind', () => {
  const counters = createCloseCounters();
  counters.begin(0);
  counters.recordClientAbort({ kind: 'run', nowMs: 1_000 });
  counters.recordClientAbort({ kind: 'invalidation', nowMs: 2_000 });
  counters.recordClose({ kind: 'run', reason: 'shutdown', nowMs: 3_000 });
  counters.recordClose({ kind: 'run', reason: 'slow-client', nowMs: 4_000 });
  counters.recordClose({
    kind: 'invalidation',
    reason: undefined,
    nowMs: 5_000,
  });
  counters.recordClose({ kind: 'run', reason: 'mystery', nowMs: 6_000 });
  const snapshot = counters.snapshot();
  assert.equal(snapshot.run.clientAbort.total, 1);
  assert.equal(snapshot.invalidation.clientAbort.total, 1);
  assert.equal(snapshot.run.shutdown.total, 1);
  assert.equal(snapshot.run.slowClient.total, 1);
  assert.equal(snapshot.invalidation.normal.total, 1);
  assert.equal(snapshot.run.otherError.total, 1);
});

test('begin resets counts and restarts the elapsed clock', () => {
  const counters = createCloseCounters();
  counters.begin(0);
  counters.recordClose({ kind: 'run', reason: 'evicted', nowMs: 1_000 });
  counters.begin(60_000);
  counters.recordClose({ kind: 'run', reason: 'evicted', nowMs: 61_000 });
  const snapshot = counters.snapshot();
  assert.equal(snapshot.run.evicted.total, 1);
  assert.equal(snapshot.run.evicted.buckets.under5s, 1);
});

test('a close without a recorded owner still counts but never attributes', () => {
  const counters = createCloseCounters();
  counters.begin(0);
  counters.recordClose({ kind: 'run', reason: 'revoked', nowMs: 50 });
  assert.equal(counters.snapshot().run.revokedOther.total, 1);
});

test('every local module the load api imports is mounted into the api container', async () => {
  const apiMain = await readFile(
    join(root, 'backend/test/e2e/chat-load-api-main.mjs'),
    'utf8',
  );
  // The api image carries no backend/test/: every helper reaches the
  // container through a compose overlay mount or an e2e.mjs env binding
  // (IDENTITY_TEST_ENTRY_PATH style).
  const compose = (
    await Promise.all(
      (await readdir(join(root, 'backend/test/e2e')))
        .filter((name) => /^compose\..+\.yml$/u.test(name))
        .map((name) => readFile(join(root, 'backend/test/e2e', name), 'utf8')),
    )
  ).join('\n');
  const e2eRunner = await readFile(join(root, 'scripts/e2e.mjs'), 'utf8');
  const relativeImports = [
    ...apiMain.matchAll(/from '(\.{1,2}\/[^']+\.mjs)'/gu),
    ...apiMain.matchAll(/import\('(\.{1,2}\/[^']+\.mjs)'\)/gu),
  ].map((match) => match[1]);
  assert.ok(relativeImports.length > 0);
  for (const specifier of relativeImports) {
    const repoPath = relative(
      root,
      resolve(root, 'backend/test/e2e', specifier),
    )
      .split(sep)
      .join('/');
    const mounted =
      compose.includes(`./${repoPath}:`) || e2eRunner.includes(`'${repoPath}'`);
    assert.ok(
      mounted,
      `no overlay mount or env binding ships ${repoPath} to the api container`,
    );
  }
});
