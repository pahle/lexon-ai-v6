import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BURST_RESULT_KEYS,
  buildBurstResult,
  createPoolMetrics,
  loadMetricsEnabled,
  parseBurstOptions,
  percentile,
} from '../../backend/test/load/burst-harness.mjs';

test('burst options default to 500 clients, both modes, 30 s ramp', () => {
  assert.deepEqual(parseBurstOptions({}), {
    clients: 500,
    runStreams: 250,
    invalidationStreams: 250,
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
    20,
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
