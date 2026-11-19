// Thread-level memory of which answers were seen running in this page
// session. The assistant message can be remounted when the runtime imports the
// canonical tree at the end of a run; a remounted indicator reads this store
// to continue the run or to play the finish instead of jumping to the static
// mark. Module scope, keyed by message id.
interface Run {
  startedAtMs: number;
  seed: number;
  finishTaken: boolean;
}

const runs = new Map<string, Run>();

/** Records the first start and seed for an id; later calls return the same. */
export function noteRunning(
  messageId: string,
  nowMs: number,
  seed: number,
): { startedAtMs: number; seed: number } {
  let run = runs.get(messageId);
  if (!run) {
    run = { startedAtMs: nowMs, seed, finishTaken: false };
    runs.set(messageId, run);
  }
  return { startedAtMs: run.startedAtMs, seed: run.seed };
}

/** 'animate' once for an id seen running, otherwise 'static'. */
export function takeFinish(messageId: string): 'animate' | 'static' {
  const run = runs.get(messageId);
  if (!run || run.finishTaken) return 'static';
  run.finishTaken = true;
  return 'animate';
}

export function forget(messageId: string): void {
  runs.delete(messageId);
}

export function resetIndicatorRuns(): void {
  runs.clear();
}
