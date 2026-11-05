export const RUN_STREAM_LIMITS = Object.freeze({
  maxEntries: 1024,
  maxEventBytes: 4096,
  slotBytes: 6_291_456,
  maxActive: 24,
  maxTerminal: 6,
  terminalTtlSeconds: 3600,
  reconciliationBatch: 30,
});

export interface StreamCapacityOptions {
  readonly maxEntries?: number;
  readonly maxEventBytes?: number;
  readonly slotBytes?: number;
  readonly maxActive?: number;
  readonly maxTerminal?: number;
  readonly terminalTtlSeconds?: number;
}

/** Fixed bounded run-stream pool sizing; changing a cap requires owner review. */
export class StreamCapacity {
  readonly limits: typeof RUN_STREAM_LIMITS;

  constructor(options: StreamCapacityOptions = {}) {
    for (const [key, expected] of Object.entries(RUN_STREAM_LIMITS)) {
      const candidate = options[key as keyof StreamCapacityOptions];
      if (candidate !== undefined && candidate !== expected)
        throw new Error(`Invalid run stream capacity: ${key}`);
    }
    this.limits = RUN_STREAM_LIMITS;
  }

  assertSlotBytes(actualBytes: number): void {
    if (
      !Number.isSafeInteger(actualBytes) ||
      actualBytes > this.limits.slotBytes
    )
      throw new Error('Run stream slot exceeds configured memory budget');
  }
}
