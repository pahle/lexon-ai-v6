export const BURST_RESULT_KEYS: string[];
export function percentile(values: number[], quantile: number): number | null;
export function parseBurstOptions(env: Record<string, string | undefined>): {
  clients: number;
  runStreams: number;
  heldRuns: number;
  invalidationStreams: number;
  modes: Array<'ramp' | 'burst'>;
  rampSeconds: number;
};
export function buildBurstResult(input: {
  mode: string;
  clients: number;
  firstFrameMs: number[];
  rssBytes: number[];
  authPoolWaitMs: number[];
  poolWaitingMax: number | null;
  serverPeakOpenSse?: number | null;
  closeReasons?: unknown;
  replayFirstFrameMs?: number[];
}): {
  mode: string;
  clients: number;
  admitted: number;
  p95FirstFrameMs: number | null;
  peakBackendRssMiB: number;
  authPoolWaitP95Ms: number | null;
  poolWaitingMax: number | null;
  serverPeakOpenSse: number | null;
  closeReasons: unknown;
  replayP95FirstFrameMs: number | null;
};
export function loadMetricsEnabled(
  env: Record<string, string | undefined>,
): boolean;
export function createPoolMetrics(env: Record<string, string | undefined>): {
  enabled: boolean;
  observe(pool: unknown): void;
  sample(): void;
  reset(): void;
  snapshot(): { waitingMax: number | null; waitMs: number[] };
};
export function createSseCounter(
  env: Record<string, string | undefined>,
  now?: () => number,
): {
  enabled: boolean;
  opened(id: string): void;
  closed(id: string): void;
  reset(): void;
  snapshot(): {
    open: number | null;
    peak: number | null;
    openedTotal: number | null;
    closedTotal: number | null;
    lastOpenElapsedMs: number | null;
  };
};
export function isCapacityRefusal(status: number, body: unknown): boolean;
export function drainBoundMs(
  heldRuns: number,
  concurrency: number,
  options?: { waveMs?: number; slackMs?: number },
): number;
export function observeSseResponses(
  counter: {
    enabled: boolean;
    opened(id: string): void;
    closed(id: string): void;
  },
  prototype: { writeHead: (...args: never[]) => unknown },
  onResponseClose?: (response: unknown) => void,
  onResponseWrite?: (response: unknown) => void,
  onResponseEnd?: (response: unknown) => void,
): void;
export function createRetryBudget(
  limitMs: number,
  now?: () => number,
): {
  refused(): void;
  pause(): void;
  resume(): void;
  elapsedMs(): number;
  expired(): boolean;
};
export function classifySlots(
  rows: Array<{ runId: string; status: string | null }>,
): { total: number; active: string[]; leaked: string[] };
