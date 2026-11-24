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
  'serverPeakOpenSse',
  'closeReasons',
  'replayP95FirstFrameMs',
];

const MODES = ['ramp', 'burst'];
const MAX_ACTIVE_RUNS = 24;

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
  // Live run streams are bounded by the global active-run cap (24); the rest
  // are chat invalidation streams from distinct users.
  const heldRuns = Math.min(MAX_ACTIVE_RUNS, Math.floor(clients / 5));
  return {
    clients,
    runStreams: heldRuns,
    heldRuns,
    invalidationStreams: clients - heldRuns,
    modes,
    rampSeconds: 30,
  };
}

// The API wraps every error as { error: { code, message }, requestId }. Only a
// 503 carrying AI_CAPACITY_EXCEEDED means "the active-run cap is full, try
// again"; every other status or code is a real failure.
export function isCapacityRefusal(status, body) {
  if (status !== 503 || typeof body !== 'object' || body === null) return false;
  const error = body.error;
  return (
    typeof error === 'object' &&
    error !== null &&
    error.code === 'AI_CAPACITY_EXCEEDED'
  );
}

// Upper bound for held runs to reach a terminal status after release: the
// worker runs `concurrency` runs at a time, so the runs drain in
// ceil(held / concurrency) waves of `waveMs` each, plus fixed slack.
export function drainBoundMs(
  heldRuns,
  concurrency,
  { waveMs = 10_000, slackMs = 30_000 } = {},
) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw new Error('worker concurrency must be a positive integer');
  return Math.ceil(heldRuns / concurrency) * waveMs + slackMs;
}

const MIB = 1024 * 1024;

export function buildBurstResult({
  mode,
  clients,
  firstFrameMs,
  rssBytes,
  authPoolWaitMs,
  poolWaitingMax,
  serverPeakOpenSse = null,
  closeReasons = null,
  replayFirstFrameMs = [],
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
    serverPeakOpenSse,
    closeReasons,
    replayP95FirstFrameMs: percentile(replayFirstFrameMs, 0.95),
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

// Test-only server-side count of open SSE connections (run streams and chat
// invalidation streams both pass through the connection registry). Disabled
// unless LEXON_LOAD_METRICS=1. Keyed by connection id, so repeats are no-ops.
// openedTotal/closedTotal are the per-window cumulative counts the z-burst
// close-drain barrier polls (`closedTotal >= openedTotal` proves every
// counted open saw its counted close); lastOpenElapsedMs shows whether
// closes could have preceded the last open.
export function createSseCounter(env, now = () => Date.now()) {
  const enabled = loadMetricsEnabled(env);
  const open = new Set();
  let peak = 0;
  let openedTotal = 0;
  let closedTotal = 0;
  let lastOpenedAtMs = null;
  return {
    enabled,
    opened(id) {
      if (!enabled) return;
      if (!open.has(id)) {
        openedTotal += 1;
        lastOpenedAtMs = now();
      }
      open.add(id);
      peak = Math.max(peak, open.size);
    },
    closed(id) {
      if (!enabled) return;
      if (open.delete(id)) closedTotal += 1;
    },
    reset() {
      peak = open.size;
      // Streams still open carry into the next window, so they count as
      // opened there too — otherwise their closes could never drain it.
      openedTotal = open.size;
      closedTotal = 0;
      lastOpenedAtMs = null;
    },
    snapshot() {
      return enabled
        ? {
            open: open.size,
            peak,
            openedTotal,
            closedTotal,
            lastOpenElapsedMs:
              lastOpenedAtMs === null ? null : now() - lastOpenedAtMs,
          }
        : {
            open: null,
            peak: null,
            openedTotal: null,
            closedTotal: null,
            lastOpenElapsedMs: null,
          };
    },
  };
}

// Counts actual open SSE response streams: wraps `prototype.writeHead` (the
// http.ServerResponse prototype in the API) so a response whose content type
// is text/event-stream is opened once, and closed on its own 'close' event.
// Registry leases are deliberately not used: an unreleased lease is not an
// open socket. `onResponseClose` observes the same close event for the
// close-reason counter, `onResponseWrite` fires inside `response.write` —
// the rendezvous that lets the instrumentation pair the stream's service
// sink (which names a close reason) to this response — and `onResponseEnd`
// fires inside `response.end`, the same rendezvous for a counted stream
// whose service close lands before any body write: sink.close() ends the
// response inside the stream key, so the close can still pair instead of
// arriving unpaired and recording a second reason.
export function observeSseResponses(
  counter,
  prototype,
  onResponseClose,
  onResponseWrite,
  onResponseEnd,
) {
  if (!counter.enabled) return;
  const original = prototype.writeHead;
  const seen = new WeakSet();
  let next = 0;
  prototype.writeHead = function (...args) {
    const result = Reflect.apply(original, this, args);
    const type = this.getHeader?.('content-type');
    if (
      !seen.has(this) &&
      typeof type === 'string' &&
      type.includes('text/event-stream')
    ) {
      seen.add(this);
      const id = `response-${++next}`;
      counter.opened(id);
      this.once('close', () => {
        counter.closed(id);
        onResponseClose?.(this);
      });
      const originalWrite = this.write;
      if (typeof originalWrite === 'function')
        this.write = function (...writeArgs) {
          onResponseWrite?.(this);
          return Reflect.apply(originalWrite, this, writeArgs);
        };
      const originalEnd = this.end;
      if (typeof originalEnd === 'function')
        this.end = function (...endArgs) {
          onResponseEnd?.(this);
          return Reflect.apply(originalEnd, this, endArgs);
        };
    }
    return result;
  };
}

// Admission retry budget for one held run. The clock starts at the first
// capacity refusal (not at the start of the attempt) and does not run while
// paused, so waiting for the database slot count never spends it.
export function createRetryBudget(limitMs, now = () => Date.now()) {
  let startedAt = null;
  let pausedAt = null;
  let pausedMs = 0;
  const elapsedMs = () => {
    if (startedAt === null) return 0;
    const end = pausedAt ?? now();
    return Math.max(0, end - startedAt - pausedMs);
  };
  return {
    refused() {
      if (startedAt === null) startedAt = now();
    },
    pause() {
      if (pausedAt === null) pausedAt = now();
    },
    resume() {
      if (pausedAt === null) return;
      // A pause before the first refusal is outside the budget altogether.
      if (startedAt !== null) pausedMs += now() - Math.max(pausedAt, startedAt);
      pausedAt = null;
    },
    elapsedMs,
    expired: () => elapsedMs() > limitMs,
  };
}

const ACTIVE_STATUSES = [
  'queued',
  'running',
  'awaiting_approval',
  'cancelling',
];

// Rows of ops.ai_run_slots joined to their run status. A slot whose run is not
// in an active status (or has no run) is a capacity leak.
export function classifySlots(rows) {
  const active = [];
  const leaked = [];
  for (const row of rows)
    (ACTIVE_STATUSES.includes(row.status) ? active : leaked).push(row.runId);
  return { total: rows.length, active, leaked };
}
