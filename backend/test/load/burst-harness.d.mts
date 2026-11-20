export const BURST_RESULT_KEYS: string[];
export function percentile(values: number[], quantile: number): number | null;
export function parseBurstOptions(env: Record<string, string | undefined>): {
  clients: number;
  runStreams: number;
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
}): {
  mode: string;
  clients: number;
  admitted: number;
  p95FirstFrameMs: number | null;
  peakBackendRssMiB: number;
  authPoolWaitP95Ms: number | null;
  poolWaitingMax: number | null;
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
