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
  'serverEnd',
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
  // Streams (opaque keys supplied by the instrumentation) that already carry
  // a close reason. First reason wins: a stream records exactly one reason,
  // whether the service-named close or the response 'close' classification
  // lands first.
  const reasoned = new Set();
  // Global outcome tallies, independent of ownerIndex. Run-stream
  // evicted/shutdown closes flatten to 'revoked' at the hub subscription
  // boundary (subscription.revoke() is hardcoded close('revoked') and the
  // true reason reaches only the raw controller sink, unreachable from the
  // harness), so the early-close hypothesis pair — renew-reject vs
  // lease-expiry-evict vs revalidation-fail — separates here in aggregate,
  // not per stream. These are outcome tallies, not stream attributions.
  const causeTallies = {
    renewal: { succeeded: 0, missing: 0, rejected: 0 },
    revalidation: {
      succeeded: 0,
      authRequired: 0,
      auth2faRequired: 0,
      authUnavailable: 0,
      other: 0,
    },
  };
  const resetTallies = () => {
    for (const group of Object.values(causeTallies))
      for (const key of Object.keys(group)) group[key] = 0;
  };
  const note = (ownerIndex, kind, nowMs) => {
    if (ownerIndex === undefined) return;
    pending.set(ownerIndex, { kind, at: nowMs });
  };
  // Returns false when this stream already carries a reason; an unpaired
  // stream (undefined key) always records — never silently dropped.
  const claim = (stream) => {
    if (stream === undefined) return true;
    if (reasoned.has(stream)) return false;
    reasoned.add(stream);
    return true;
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
      reasoned.clear();
      resetTallies();
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
      reasoned.clear();
      resetTallies();
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
    // One `registry.renew` call's outcome, ownerIndex-free: a falsy lease
    // return reads 'missing' (the service maps it to `evicted`), a rejected
    // promise 'rejected' (the service maps it to `revoked`).
    noteRenewOutcome(outcome) {
      if (Object.hasOwn(causeTallies.renewal, outcome))
        causeTallies.renewal[outcome] += 1;
    },
    // One `revalidation.assert` call's outcome bucket, ownerIndex-free.
    noteRevalidationOutcome(outcome) {
      if (Object.hasOwn(causeTallies.revalidation, outcome))
        causeTallies.revalidation[outcome] += 1;
    },
    // The tallies are emitted whole — a zero is evidence too (a close wave
    // with `rejected: 0, missing: 40` names lease expiry, not renew errors).
    causes() {
      return {
        renewal: { ...causeTallies.renewal },
        revalidation: { ...causeTallies.revalidation },
      };
    },
    recordClose({ kind, reason, ownerIndex, stream, nowMs }) {
      if (!CLOSE_KINDS.includes(kind)) return;
      if (!claim(stream)) return;
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
    recordClientAbort({ kind, stream, nowMs }) {
      if (!CLOSE_KINDS.includes(kind)) return;
      if (!claim(stream)) return;
      increment(kind, 'clientAbort', nowMs);
    },
    // The response 'close' event for a gauge-counted stream: a finished
    // response was ended server-side, an unfinished one is a client abort.
    // Suppressed when the service close already named this stream's reason.
    recordResponseClose({ kind, stream, finished, nowMs }) {
      if (!CLOSE_KINDS.includes(kind)) return;
      if (!claim(stream)) return;
      increment(kind, finished ? 'serverEnd' : 'clientAbort', nowMs);
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
