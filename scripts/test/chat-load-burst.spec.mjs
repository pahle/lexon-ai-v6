import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import {
  BURST_RESULT_KEYS,
  buildBurstResult,
  classifySlots,
  createPoolMetrics,
  createRetryBudget,
  createSseCounter,
  drainBoundMs,
  isCapacityRefusal,
  loadMetricsEnabled,
  observeSseResponses,
  parseBurstOptions,
  percentile,
} from '../../backend/test/load/burst-harness.mjs';

test('burst options default to 500 clients, both modes, 30 s ramp', () => {
  assert.deepEqual(parseBurstOptions({}), {
    clients: 500,
    runStreams: 24,
    heldRuns: 24,
    invalidationStreams: 476,
    modes: ['ramp', 'burst'],
    rampSeconds: 30,
  });
});

test('burst options accept a single mode and reject invalid input', () => {
  assert.deepEqual(parseBurstOptions({ LEXON_BURST_MODES: 'burst' }).modes, [
    'burst',
  ]);
  assert.throws(() => parseBurstOptions({ LEXON_BURST_MODES: 'flood' }));
  assert.throws(() => parseBurstOptions({ LEXON_BURST_CLIENTS: '3' }));
  assert.throws(() => parseBurstOptions({ LEXON_BURST_CLIENTS: '-4' }));
  assert.equal(
    parseBurstOptions({ LEXON_BURST_CLIENTS: '40' }).invalidationStreams,
    32,
  );
});

test('percentile is nearest-rank and handles empty input', () => {
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([5, 1, 3, 2, 4], 0.95), 5);
  assert.equal(percentile([10, 20, 30, 40], 0.5), 20);
});

test('result JSON has exactly the recorded keys', () => {
  const result = buildBurstResult({
    mode: 'burst',
    clients: 500,
    firstFrameMs: [100, 200, 300],
    rssBytes: [100 * 1024 * 1024, 200 * 1024 * 1024],
    authPoolWaitMs: [1, 2, 3, 400],
    poolWaitingMax: null,
  });
  assert.deepEqual(Object.keys(result).sort(), [...BURST_RESULT_KEYS].sort());
  assert.equal(result.admitted, 3);
  assert.equal(result.clients, 500);
  assert.equal(result.p95FirstFrameMs, 300);
  assert.equal(result.peakBackendRssMiB, 200);
  assert.equal(result.authPoolWaitP95Ms, 400);
  assert.equal(result.poolWaitingMax, null);
});

test('pg-pool waitingCount metric is off unless LEXON_LOAD_METRICS=1', () => {
  assert.equal(loadMetricsEnabled({}), false);
  assert.equal(loadMetricsEnabled({ LEXON_LOAD_METRICS: '0' }), false);
  assert.equal(loadMetricsEnabled({ LEXON_LOAD_METRICS: 'true' }), false);
  assert.equal(loadMetricsEnabled({ LEXON_LOAD_METRICS: '1' }), true);

  const pool = { options: { max: 10 }, waitingCount: 7, connect() {} };
  const original = pool.connect;
  const off = createPoolMetrics({});
  assert.equal(off.enabled, false);
  off.observe(pool);
  assert.equal(pool.connect, original, 'a disabled metric never wraps a pool');
  off.sample();
  assert.deepEqual(off.snapshot(), { waitingMax: null, waitMs: [] });

  const on = createPoolMetrics({ LEXON_LOAD_METRICS: '1' });
  on.observe(pool);
  on.sample();
  assert.equal(on.snapshot().waitingMax, 7);
});

test('an enabled metric records connect wait time', async () => {
  const pool = {
    options: { max: 10 },
    waitingCount: 0,
    connect: () => new Promise((resolve) => setTimeout(resolve, 20)),
  };
  const metrics = createPoolMetrics({ LEXON_LOAD_METRICS: '1' });
  metrics.observe(pool);
  await pool.connect();
  const { waitMs } = metrics.snapshot();
  assert.equal(waitMs.length, 1);
  assert.ok(waitMs[0] >= 10);
});

test('open-SSE counter is off unless LEXON_LOAD_METRICS=1', () => {
  const off = createSseCounter({});
  assert.equal(off.enabled, false);
  off.opened('a');
  assert.deepEqual(off.snapshot(), {
    open: null,
    peak: null,
    openedTotal: null,
    closedTotal: null,
    lastOpenElapsedMs: null,
  });
});

test('open-SSE counter tracks the server-side peak per window', () => {
  const counter = createSseCounter({ LEXON_LOAD_METRICS: '1' }, () => 1_000);
  counter.opened('a');
  counter.opened('b');
  counter.opened('c');
  counter.closed('b');
  assert.deepEqual(counter.snapshot(), {
    open: 2,
    peak: 3,
    openedTotal: 3,
    closedTotal: 1,
    lastOpenElapsedMs: 0,
  });
  counter.opened('a');
  assert.equal(counter.snapshot().open, 2, 'a repeated id is not recounted');
  assert.equal(
    counter.snapshot().openedTotal,
    3,
    'a repeated id is not a new open',
  );
  counter.closed('unknown');
  counter.closed('b');
  assert.equal(counter.snapshot().open, 2, 'a repeated close is a no-op');
  assert.equal(counter.snapshot().closedTotal, 1);
  counter.reset();
  // 'a' and 'c' are still open: they carry into the next window's totals.
  assert.deepEqual(counter.snapshot(), {
    open: 2,
    peak: 2,
    openedTotal: 2,
    closedTotal: 0,
    lastOpenElapsedMs: null,
  });
  counter.closed('a');
  counter.opened('d');
  assert.deepEqual(counter.snapshot(), {
    open: 2,
    peak: 2,
    openedTotal: 3,
    closedTotal: 1,
    lastOpenElapsedMs: 0,
  });
});

test('open-SSE counter reports the last-open elapsed per window', () => {
  let now = 1_000;
  const counter = createSseCounter({ LEXON_LOAD_METRICS: '1' }, () => now);
  counter.opened('a');
  counter.opened('b');
  counter.closed('a');
  now = 2_500;
  assert.deepEqual(counter.snapshot(), {
    open: 1,
    peak: 2,
    openedTotal: 2,
    closedTotal: 1,
    lastOpenElapsedMs: 1_500,
  });
});

test('the result records the server-side peak and the replay latency', () => {
  const result = buildBurstResult({
    mode: 'ramp',
    clients: 500,
    firstFrameMs: [1],
    rssBytes: [],
    authPoolWaitMs: [],
    poolWaitingMax: null,
    serverPeakOpenSse: 502,
    replayFirstFrameMs: [10, 20],
  });
  assert.equal(result.serverPeakOpenSse, 502);
  assert.equal(result.replayP95FirstFrameMs, 20);
  assert.ok(BURST_RESULT_KEYS.includes('serverPeakOpenSse'));
});

test('burst options split 24 held runs from the invalidation streams', () => {
  const options = parseBurstOptions({});
  assert.equal(options.heldRuns, 24);
  assert.equal(options.invalidationStreams, 476);
  assert.equal(options.runStreams, 24);
  const small = parseBurstOptions({ LEXON_BURST_CLIENTS: '40' });
  assert.equal(small.heldRuns, 8);
  assert.equal(small.invalidationStreams, 32);
});

test('capacity refusal is read from the API error envelope, not a top-level code', () => {
  const envelope = {
    error: { code: 'AI_CAPACITY_EXCEEDED', message: 'The AI service is busy.' },
    requestId: 'r1',
  };
  assert.equal(isCapacityRefusal(503, envelope), true);
  assert.equal(isCapacityRefusal(503, { code: 'AI_CAPACITY_EXCEEDED' }), false);
});

test('only a 503 AI_CAPACITY_EXCEEDED is a capacity refusal', () => {
  const capacity = { error: { code: 'AI_CAPACITY_EXCEEDED' } };
  assert.equal(isCapacityRefusal(500, capacity), false);
  assert.equal(isCapacityRefusal(409, capacity), false);
  assert.equal(
    isCapacityRefusal(503, { error: { code: 'AUTH_UNAVAILABLE' } }),
    false,
  );
  assert.equal(isCapacityRefusal(503, null), false);
  assert.equal(isCapacityRefusal(503, 'AI_CAPACITY_EXCEEDED'), false);
  assert.equal(isCapacityRefusal(503, {}), false);
});

test('drain bound is waves of worker concurrency times the wave budget plus slack', () => {
  // 24 held runs at worker concurrency 4 are 6 waves.
  assert.equal(
    drainBoundMs(24, 4, { waveMs: 10_000, slackMs: 30_000 }),
    90_000,
  );
  assert.equal(drainBoundMs(8, 4, { waveMs: 10_000, slackMs: 30_000 }), 50_000);
  assert.equal(drainBoundMs(5, 4, { waveMs: 10_000, slackMs: 0 }), 20_000);
  assert.throws(() => drainBoundMs(24, 0));
});

// A minimal stand-in for http.ServerResponse: headers set before writeHead.
function fakeResponse(contentType) {
  const response = new EventEmitter();
  response.getHeader = (name) =>
    name === 'content-type' ? contentType : undefined;
  response.writeHead = function () {
    return this;
  };
  return response;
}

test('open-SSE counts response streams on open and decrements on close', () => {
  const counter = createSseCounter({ LEXON_LOAD_METRICS: '1' }, () => 1_000);
  const proto = { writeHead() {} };
  observeSseResponses(counter, proto);
  const a = Object.assign(fakeResponse('text/event-stream; charset=utf-8'), {
    writeHead: proto.writeHead,
  });
  const b = Object.assign(fakeResponse('text/event-stream'), {
    writeHead: proto.writeHead,
  });
  a.writeHead(200);
  b.writeHead(200);
  assert.deepEqual(counter.snapshot(), {
    open: 2,
    peak: 2,
    openedTotal: 2,
    closedTotal: 0,
    lastOpenElapsedMs: 0,
  });
  // A second writeHead on the same response is not a second stream.
  a.writeHead(200);
  assert.equal(counter.snapshot().open, 2);
  a.emit('close');
  assert.deepEqual(counter.snapshot(), {
    open: 1,
    peak: 2,
    openedTotal: 2,
    closedTotal: 1,
    lastOpenElapsedMs: 0,
  });
  b.emit('close');
  assert.equal(counter.snapshot().open, 0);
  assert.equal(counter.snapshot().closedTotal, 2);
});

test('open-SSE ignores non-SSE responses and a lease without a response', () => {
  const counter = createSseCounter({ LEXON_LOAD_METRICS: '1' }, () => 1_000);
  const proto = { writeHead() {} };
  observeSseResponses(counter, proto);
  const json = Object.assign(fakeResponse('application/json'), {
    writeHead: proto.writeHead,
  });
  json.writeHead(200);
  assert.equal(counter.snapshot().open, 0);
  // Registry leases (admit without release) no longer move the counter.
  counter.reset();
  assert.deepEqual(counter.snapshot(), {
    open: 0,
    peak: 0,
    openedTotal: 0,
    closedTotal: 0,
    lastOpenElapsedMs: null,
  });
});

test('open-SSE reports writes on counted responses only', () => {
  // The write notification is the rendezvous pairing a service sink (which
  // names a close reason) to its response: api-main marks the response with
  // the key the sink's write ran under.
  const counter = createSseCounter({ LEXON_LOAD_METRICS: '1' }, () => 1_000);
  const proto = { writeHead() {} };
  const writes = [];
  const closes = [];
  observeSseResponses(
    counter,
    proto,
    (response) => closes.push(response),
    (response) => writes.push(response),
  );
  const a = Object.assign(fakeResponse('text/event-stream'), {
    writeHead: proto.writeHead,
    write() {
      return true;
    },
  });
  const json = Object.assign(fakeResponse('application/json'), {
    writeHead: proto.writeHead,
    write() {
      return true;
    },
  });
  a.writeHead(200);
  json.writeHead(200);
  a.write('data: x\n\n');
  json.write('{}');
  assert.deepEqual(writes, [a]);
  a.emit('close');
  assert.deepEqual(closes, [a]);
});

test('retry budget starts at the first refusal, not before', () => {
  let now = 1_000;
  const budget = createRetryBudget(60_000, () => now);
  now += 500_000;
  assert.equal(budget.expired(), false);
  budget.refused();
  now += 59_999;
  assert.equal(budget.expired(), false);
  now += 2;
  assert.equal(budget.expired(), true);
});

test('retry budget keeps its first start and excludes paused waits', () => {
  let now = 0;
  const budget = createRetryBudget(60_000, () => now);
  budget.refused();
  now += 10_000;
  budget.refused();
  budget.pause();
  now += 300_000;
  budget.resume();
  now += 49_000;
  assert.equal(budget.expired(), false);
  assert.equal(budget.elapsedMs(), 59_000);
  now += 2_000;
  assert.equal(budget.expired(), true);
});

test('retry budget never expires without a refusal, even with a pause', () => {
  let now = 0;
  const budget = createRetryBudget(1_000, () => now);
  budget.pause();
  now += 9_999_999;
  budget.resume();
  assert.equal(budget.expired(), false);
  assert.equal(budget.elapsedMs(), 0);
});

test('classifySlots separates leaked slots (terminal run) from active ones', () => {
  const rows = [
    { runId: 'a', status: 'running' },
    { runId: 'b', status: 'completed' },
    { runId: 'c', status: 'queued' },
    { runId: 'd', status: 'failed' },
    { runId: 'e', status: null },
  ];
  assert.deepEqual(classifySlots(rows), {
    total: 5,
    active: ['a', 'c'],
    leaked: ['b', 'd', 'e'],
  });
  assert.deepEqual(classifySlots([]), { total: 0, active: [], leaked: [] });
});
