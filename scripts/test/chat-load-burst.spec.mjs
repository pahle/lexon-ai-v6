import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BURST_RESULT_KEYS,
  buildBurstResult,
  createPoolMetrics,
  createSseCounter,
  drainBoundMs,
  isCapacityRefusal,
  loadMetricsEnabled,
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
  assert.deepEqual(off.snapshot(), { open: null, peak: null });
});

test('open-SSE counter tracks the server-side peak per window', () => {
  const counter = createSseCounter({ LEXON_LOAD_METRICS: '1' });
  counter.opened('a');
  counter.opened('b');
  counter.opened('c');
  counter.closed('b');
  assert.deepEqual(counter.snapshot(), { open: 2, peak: 3 });
  counter.opened('a');
  assert.equal(counter.snapshot().open, 2, 'a repeated id is not recounted');
  counter.closed('unknown');
  counter.closed('b');
  assert.equal(counter.snapshot().open, 2, 'a repeated close is a no-op');
  counter.reset();
  assert.deepEqual(counter.snapshot(), { open: 2, peak: 2 });
  counter.closed('a');
  counter.opened('d');
  assert.deepEqual(counter.snapshot(), { open: 2, peak: 2 });
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
