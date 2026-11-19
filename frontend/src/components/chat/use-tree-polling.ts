import { useCallback, useEffect, useRef } from 'react';

const URGENT_MS = 1_000;
const CALM_MS = 5_000;
const FAILURE_THRESHOLD = 5;

export interface TreePollingOptions {
  readonly fetchTree: (signal: AbortSignal) => Promise<void>;
  readonly isUrgent: () => boolean;
  readonly onFailures: (count: number) => void;
  readonly now?: () => number;
  /** Polling runs only while true (default true). */
  readonly enabled?: boolean;
}

/**
 * Polls the canonical chat tree: 1 s while urgent, else 5 s; paused while the
 * tab is hidden; one immediate fetch when it becomes visible or focused; a new
 * fetch aborts the previous one.
 */
export function useTreePolling(options: TreePollingOptions): {
  refreshNow(): void;
} {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const refreshNowRef = useRef<() => void>(() => undefined);
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled) {
      refreshNowRef.current = () => undefined;
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let failures = 0;

    const hidden = () => document.visibilityState === 'hidden';
    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      clearTimer();
      if (!active || hidden()) return;
      timer = setTimeout(
        () => void run(),
        optionsRef.current.isUrgent() ? URGENT_MS : CALM_MS,
      );
    };
    const run = async () => {
      clearTimer();
      controller?.abort();
      const mine = new AbortController();
      controller = mine;
      try {
        await optionsRef.current.fetchTree(mine.signal);
        if (mine.signal.aborted) return;
        failures = 0;
      } catch {
        if (mine.signal.aborted) return;
        failures += 1;
        if (failures >= FAILURE_THRESHOLD) {
          optionsRef.current.onFailures(failures);
        }
      }
      if (controller === mine) schedule();
    };
    const onVisibility = () => {
      if (hidden()) {
        clearTimer();
        controller?.abort();
        controller = undefined;
      } else {
        void run();
      }
    };
    const onFocus = () => {
      if (!hidden()) void run();
    };

    refreshNowRef.current = () => void run();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    schedule();
    return () => {
      active = false;
      clearTimer();
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      refreshNowRef.current = () => undefined;
    };
  }, [enabled]);

  const refreshNow = useCallback(() => refreshNowRef.current(), []);
  return { refreshNow };
}
