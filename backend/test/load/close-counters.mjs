// K3 stream-close diagnosis for the F4.4 load regression: every SSE close
// lands in a named reason bucket with the elapsed ms since the mode's
// `burst-metrics` reset. Counts and reason names only — never ids, cookies
// or payloads. Imported by chat-load-api-main.mjs (inside the API container)
// and unit-tested by scripts/test/chat-load-close-counters.spec.mjs.

export const CLOSE_KINDS = ['run', 'invalidation'];

export const CLOSE_REASONS = [
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
];

export const CLOSE_ELAPSED_BUCKETS = [
  'under5s',
  '5to15s',
  '15to30s',
  '30to55s',
  '55sOrMore',
];

// The window is a 30 s ramp plus a 25 s hold, so the 30 s / 55 s edges split
// "closed during the ramp" from "closed in the hold window".
export function closeElapsedBucket(elapsedMs) {
  if (elapsedMs < 5_000) return 'under5s';
  if (elapsedMs < 15_000) return '5to15s';
  if (elapsedMs < 30_000) return '15to30s';
  if (elapsedMs < 55_000) return '30to55s';
  return '55sOrMore';
}

// A recorded revoked cause stays attributable for this long; the service
// closes the stream in the same tick the error lands, so a generous window
// still cannot misattribute a later failure.
const PENDING_CAUSE_TTL_MS = 10_000;

function emptyCounts() {
  return Object.fromEntries(CLOSE_REASONS.map((reason) => [reason, 0]));
}

export function createCloseCounters() {
  let resetAt = null;
  const totals = { run: emptyCounts(), invalidation: emptyCounts() };
  const buckets = {
    run: Object.fromEntries(CLOSE_REASONS.map((reason) => [reason, {}])),
    invalidation: Object.fromEntries(
      CLOSE_REASONS.map((reason) => [reason, {}]),
    ),
  };
  // Per load-owner index: the most recent close-eligible failure seen on the
  // revalidation or renewal path, with the ms it was observed.
  const pending = new Map();
  const note = (ownerIndex, kind, nowMs) => {
    if (ownerIndex === undefined) return;
    pending.set(ownerIndex, { kind, at: nowMs });
  };
  const increment = (kind, reason, nowMs) => {
    totals[kind][reason] += 1;
    const bucket =
      resetAt === null ? '55sOrMore' : closeElapsedBucket(nowMs - resetAt);
    const reasonBuckets = buckets[kind][reason];
    reasonBuckets[bucket] = (reasonBuckets[bucket] ?? 0) + 1;
  };
  return {
    // `burst-metrics` reset: a new mode window starts its clock here.
    begin(nowMs) {
      resetAt = nowMs;
      pending.clear();
      for (const kind of CLOSE_KINDS) {
        for (const reason of CLOSE_REASONS) {
          totals[kind][reason] = 0;
          for (const key of Object.keys(buckets[kind][reason]))
            delete buckets[kind][reason][key];
        }
      }
    },
    // `set-load-runs` (re)binds owner indexes: clear causes and counts, keep
    // the clock — the mode has not reset.
    reset(nowMs) {
      pending.clear();
      for (const kind of CLOSE_KINDS) {
        for (const reason of CLOSE_REASONS) {
          totals[kind][reason] = 0;
          for (const key of Object.keys(buckets[kind][reason]))
            delete buckets[kind][reason][key];
        }
      }
      if (resetAt === null) resetAt = nowMs;
    },
    // `revalidation.assert` failed with a stream-closing status.
    noteRevalidationCloseError(ownerIndex, status, nowMs) {
      if (status !== '401' && status !== '403' && status !== '404') return;
      note(ownerIndex, status, nowMs);
    },
    // `registry.renew` rejected; the service maps that to `revoked`.
    noteRenewRejected(ownerIndex, nowMs) {
      note(ownerIndex, 'RenewError', nowMs);
    },
    // `existsForOwnedChat` returned false → NotFoundException → `revoked`.
    noteOwnershipMissing(ownerIndex, nowMs) {
      note(ownerIndex, '404', nowMs);
    },
    // `authorizedChatSnapshot` missed → resync reload fails → `revoked`.
    noteSnapshotMissing(ownerIndex, nowMs) {
      note(ownerIndex, '404', nowMs);
    },
    recordClose({ kind, reason, ownerIndex, nowMs }) {
      if (!CLOSE_KINDS.includes(kind)) return;
      if (reason === 'revoked') {
        const candidate =
          ownerIndex === undefined ? undefined : pending.get(ownerIndex);
        const fresh =
          candidate !== undefined &&
          nowMs - candidate.at <= PENDING_CAUSE_TTL_MS;
        increment(
          kind,
          fresh ? `revoked${candidate.kind}` : 'revokedOther',
          nowMs,
        );
        return;
      }
      const mapped =
        reason === 'evicted'
          ? 'evicted'
          : reason === 'shutdown'
            ? 'shutdown'
            : reason === 'slow-client'
              ? 'slowClient'
              : reason === undefined
                ? 'normal'
                : 'otherError';
      increment(kind, mapped, nowMs);
    },
    recordClientAbort({ kind, nowMs }) {
      if (!CLOSE_KINDS.includes(kind)) return;
      increment(kind, 'clientAbort', nowMs);
    },
    // Only nonzero reasons are emitted: the control reply is capped at
    // 16 KiB and the empty keys are noise.
    snapshot() {
      const value = {};
      for (const kind of CLOSE_KINDS) {
        const out = {};
        for (const reason of CLOSE_REASONS) {
          const total = totals[kind][reason];
          if (total === 0) continue;
          out[reason] = { total, buckets: { ...buckets[kind][reason] } };
        }
        value[kind] = out;
      }
      return value;
    },
  };
}
