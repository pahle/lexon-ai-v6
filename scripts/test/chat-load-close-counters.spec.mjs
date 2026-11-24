import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import {
  createSseCounter,
  observeSseResponses,
} from '../../backend/test/load/burst-harness.mjs';
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
    'serverEnd',
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

test('a finished close is a server end, an unfinished close is a client abort', () => {
  // z-burst never sets owners, so the only name a counted close can get is
  // the writableFinished classification at the response 'close' event.
  const counters = createCloseCounters();
  counters.begin(0);
  counters.recordResponseClose({
    kind: 'run',
    stream: {},
    finished: true,
    nowMs: 100,
  });
  counters.recordResponseClose({
    kind: 'invalidation',
    stream: {},
    finished: false,
    nowMs: 200,
  });
  const snapshot = counters.snapshot();
  assert.equal(snapshot.run.serverEnd.total, 1);
  assert.equal(snapshot.run.serverEnd.buckets.under5s, 1);
  assert.equal(snapshot.invalidation.clientAbort.total, 1);
});

test('the first close reason wins: exactly one reason per counted stream', () => {
  const counters = createCloseCounters();
  counters.begin(0);
  const serviceClosed = {};
  const aborted = {};
  // A service reason lands before the response 'close': the later
  // writableFinished classification must not add serverEnd on top.
  counters.recordClose({
    kind: 'run',
    reason: 'evicted',
    stream: serviceClosed,
    nowMs: 100,
  });
  counters.recordResponseClose({
    kind: 'run',
    stream: serviceClosed,
    finished: true,
    nowMs: 150,
  });
  // A client abort lands before the service teardown close(): the later
  // no-reason close must not add normal on top of clientAbort.
  counters.recordResponseClose({
    kind: 'run',
    stream: aborted,
    finished: false,
    nowMs: 200,
  });
  counters.recordClose({
    kind: 'run',
    reason: undefined,
    stream: aborted,
    nowMs: 300,
  });
  const snapshot = counters.snapshot();
  assert.equal(snapshot.run.evicted.total, 1);
  assert.equal(snapshot.run.clientAbort.total, 1);
  const totalReasons = CLOSE_REASONS.reduce(
    (sum, reason) => sum + (snapshot.run[reason]?.total ?? 0),
    0,
  );
  assert.equal(
    totalReasons,
    2,
    'every counted stream carries exactly one close reason',
  );
});

test('an unpaired stream close records unconditionally', () => {
  // A close classification without a rendezvous key still counts: the
  // counters must never silently drop a counted stream.
  const counters = createCloseCounters();
  counters.begin(0);
  counters.recordResponseClose({
    kind: 'run',
    stream: undefined,
    finished: true,
    nowMs: 100,
  });
  counters.recordResponseClose({
    kind: 'run',
    stream: undefined,
    finished: false,
    nowMs: 200,
  });
  const snapshot = counters.snapshot();
  assert.equal(snapshot.run.serverEnd.total, 1);
  assert.equal(snapshot.run.clientAbort.total, 1);
});

test('a counted stream whose service close lands before any write records exactly one reason', () => {
  // Mirrors the api-main wiring: the counted response's wrapped write pairs
  // it with the sink's stream key on the first body write, and its wrapped
  // end pairs it when the service close reaches response.end() under
  // withStreamKey — so a stream whose service close lands before any write
  // still closes paired, and first reason wins at the counter. Without the
  // end rendezvous the response 'close' arrives unpaired (streamKeys.get is
  // undefined) and the unconditional classification adds a second reason.
  const counter = createSseCounter({ LEXON_LOAD_METRICS: '1' }, () => 1_000);
  const counters = createCloseCounters();
  counters.begin(0);
  const streamKeys = new WeakMap();
  let activeStreamKey;
  const withStreamKey = (key, run) => {
    const previous = activeStreamKey;
    activeStreamKey = key;
    try {
      return run();
    } finally {
      activeStreamKey = previous;
    }
  };
  const bind = (response) => {
    if (activeStreamKey !== undefined && !streamKeys.has(response))
      streamKeys.set(response, activeStreamKey);
  };
  const proto = { writeHead() {} };
  observeSseResponses(
    counter,
    proto,
    (response) =>
      counters.recordResponseClose({
        kind: 'run',
        stream: streamKeys.get(response),
        finished: response.writableFinished === true,
        nowMs: 1_000,
      }),
    bind,
    bind,
  );
  const response = new EventEmitter();
  response.getHeader = (name) =>
    name === 'content-type' ? 'text/event-stream; charset=utf-8' : undefined;
  response.writeHead = proto.writeHead;
  response.write = () => true;
  response.end = function () {
    this.writableFinished = true;
    return this;
  };
  // Gauge-counted (the SSE writeHead ran) but no sink write ever reached it.
  response.writeHead(200);
  assert.equal(counter.snapshot().openedTotal, 1);
  const sink = {};
  counters.recordClose({
    kind: 'run',
    reason: 'evicted',
    stream: sink,
    nowMs: 1_000,
  });
  // The wrapped sink.close reaches response.end() under the stream key.
  withStreamKey(sink, () => response.end());
  response.emit('close');
  assert.equal(
    streamKeys.get(response),
    sink,
    'the service close pairs the response to its stream key at end()',
  );
  const snapshot = counters.snapshot();
  assert.equal(snapshot.run.evicted.total, 1);
  const totalReasons = CLOSE_REASONS.reduce(
    (sum, reason) => sum + (snapshot.run[reason]?.total ?? 0),
    0,
  );
  assert.equal(
    totalReasons,
    1,
    'exactly one recorded close reason per counted stream',
  );
});

test('the stream dedup resets with the window', () => {
  const counters = createCloseCounters();
  const stream = {};
  counters.begin(0);
  counters.recordClose({
    kind: 'run',
    reason: 'evicted',
    stream,
    nowMs: 100,
  });
  counters.begin(60_000);
  counters.recordResponseClose({
    kind: 'run',
    stream,
    finished: true,
    nowMs: 61_000,
  });
  const snapshot = counters.snapshot();
  assert.equal(snapshot.run.serverEnd.total, 1);
});

test('the sse counter snapshot carries cumulative opens and closes', () => {
  // burst-metrics returns sseCounter.snapshot() verbatim as `sse`; the
  // z-burst close-drain barrier polls closedTotal >= openedTotal, and the
  // last-open elapsed shows whether closes preceded the last open.
  const counter = createSseCounter({ LEXON_LOAD_METRICS: '1' }, () => 5_000);
  counter.opened('a');
  counter.opened('b');
  counter.closed('a');
  const snapshot = counter.snapshot();
  assert.equal(snapshot.openedTotal, 2);
  assert.equal(snapshot.closedTotal, 1);
  assert.equal(snapshot.lastOpenElapsedMs, 0);
  counter.reset();
  assert.equal(counter.snapshot().closedTotal, 0);
});

test('burst-metrics reports the sse counter snapshot verbatim', async () => {
  const apiMain = await readFile(
    join(root, 'backend/test/e2e/chat-load-api-main.mjs'),
    'utf8',
  );
  assert.match(apiMain, /sse:\s*sseCounter\.snapshot\(\)/u);
});

test('cause outcome tallies count renewal and revalidation without ownerIndex', () => {
  // Run-stream evicted/shutdown flatten to 'revoked' at the hub boundary,
  // so the global tallies — emitted as `causes` — separate the early-close
  // hypotheses in aggregate. Zero counts are evidence: emit the full shape.
  const counters = createCloseCounters();
  counters.begin(0);
  counters.noteRenewOutcome('succeeded');
  counters.noteRenewOutcome('missing');
  counters.noteRenewOutcome('rejected');
  counters.noteRenewOutcome('rejected');
  counters.noteRevalidationOutcome('succeeded');
  counters.noteRevalidationOutcome('authRequired');
  counters.noteRevalidationOutcome('other');
  counters.noteRenewOutcome('bogus');
  counters.noteRevalidationOutcome('bogus');
  assert.deepEqual(counters.causes(), {
    renewal: { succeeded: 1, missing: 1, rejected: 2 },
    revalidation: {
      succeeded: 1,
      authRequired: 1,
      auth2faRequired: 0,
      authUnavailable: 0,
      other: 1,
    },
  });
});

test('cause tallies reset with the window', () => {
  const counters = createCloseCounters();
  counters.begin(0);
  counters.noteRenewOutcome('rejected');
  counters.noteRevalidationOutcome('authUnavailable');
  counters.begin(60_000);
  const causes = counters.causes();
  assert.equal(causes.renewal.rejected, 0);
  assert.equal(causes.revalidation.authUnavailable, 0);
});

test('burst-metrics emits the cause tallies and the api counts outcomes ungated', async () => {
  const apiMain = await readFile(
    join(root, 'backend/test/e2e/chat-load-api-main.mjs'),
    'utf8',
  );
  assert.match(apiMain, /causes:\s*closeCounters\.causes\(\)/u);
  // The tally calls sit in the renew/revalidation wrappers without an
  // ownerIndex gate — z-burst never sets owners, so gating would starve
  // the only early-close evidence the run kind has.
  assert.match(
    apiMain,
    /noteRenewOutcome\(lease \? 'succeeded' : 'missing'\)/u,
  );
  assert.match(apiMain, /noteRenewOutcome\('rejected'\)/u);
  assert.match(apiMain, /noteRevalidationOutcome\('succeeded'\)/u);
  assert.match(apiMain, /noteRevalidationOutcome\(outcome\)/u);
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

test('the z-burst spec records per-window close sums and writes evidence before a window failure throws', async () => {
  const spec = await readFile(
    join(root, 'backend/test/e2e/chat-sse-load.z-burst.spec.ts'),
    'utf8',
  );
  // Per-window evidence: the reason ledger sums per kind plus the counted
  // closes (closedTotal) for the same window.
  assert.match(spec, /closeSums/u);
  // A capped run never loses its evidence: the write precedes each
  // window-scoped throw (absent fields, drain expiry, ledger mismatch).
  assert.match(spec, /await writeEvidence\(\);\s*\n\s*throw new Error\(/u);
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
