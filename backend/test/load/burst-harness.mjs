// Pure helpers for the F4.2 S2 burst harness (item 27). Imported by the burst
// E2E spec (host) and, for the test-only pool metric, by chat-load-api-main.mjs
// (inside the API container). Nothing here is production code.

export const BURST_RESULT_KEYS = [
  'mode',
  'clients',
  'admitted',
  'p95FirstFrameMs',
  'peakBackendRssMiB',
  'authPoolWaitP95Ms',
  'poolWaitingMax',
];

const MODES = ['ramp', 'burst'];

export function percentile(values, quantile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * quantile) - 1];
}

export function parseBurstOptions(env) {
  const clients = env.LEXON_BURST_CLIENTS
    ? Number(env.LEXON_BURST_CLIENTS)
    : 500;
  if (!Number.isSafeInteger(clients) || clients < 4)
    throw new Error('LEXON_BURST_CLIENTS must be an integer of at least 4');
  const modes = env.LEXON_BURST_MODES
    ? env.LEXON_BURST_MODES.split(',').map((mode) => mode.trim())
    : [...MODES];
  if (modes.length === 0 || modes.some((mode) => !MODES.includes(mode)))
    throw new Error('LEXON_BURST_MODES must list ramp and/or burst');
  const runStreams = Math.ceil(clients / 2);
  return {
    clients,
    runStreams,
    invalidationStreams: clients - runStreams,
    modes,
    rampSeconds: 30,
  };
}

const MIB = 1024 * 1024;

export function buildBurstResult({
  mode,
  clients,
  firstFrameMs,
  rssBytes,
  authPoolWaitMs,
  poolWaitingMax,
}) {
  const peak = rssBytes.length === 0 ? 0 : Math.max(...rssBytes);
  return {
    mode,
    clients,
    admitted: firstFrameMs.length,
    p95FirstFrameMs: percentile(firstFrameMs, 0.95),
    peakBackendRssMiB: Math.round((peak / MIB) * 10) / 10,
    authPoolWaitP95Ms: percentile(authPoolWaitMs, 0.95),
    poolWaitingMax,
  };
}

export function loadMetricsEnabled(env) {
  return env.LEXON_LOAD_METRICS === '1';
}

// Test-only pg-pool observation. Disabled unless LEXON_LOAD_METRICS=1: a
// disabled instance never touches a pool.
export function createPoolMetrics(env) {
  const enabled = loadMetricsEnabled(env);
  const pools = [];
  let waitingMax = 0;
  let waitMs = [];
  return {
    enabled,
    observe(pool) {
      if (!enabled || pools.includes(pool)) return;
      pools.push(pool);
      const original = pool.connect;
      pool.connect = function (...args) {
        if (typeof args[0] === 'function') return original.apply(this, args);
        const startedAt = performance.now();
        const result = original.apply(this, args);
        void Promise.resolve(result).then(
          () => waitMs.push(performance.now() - startedAt),
          () => waitMs.push(performance.now() - startedAt),
        );
        return result;
      };
    },
    sample() {
      if (!enabled) return;
      for (const pool of pools)
        waitingMax = Math.max(waitingMax, pool.waitingCount ?? 0);
    },
    reset() {
      waitingMax = 0;
      waitMs = [];
    },
    snapshot() {
      return enabled
        ? { waitingMax, waitMs: [...waitMs] }
        : { waitingMax: null, waitMs: [] };
    },
  };
}
