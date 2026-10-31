import { mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseHealthSnapshot, type HealthSnapshot } from './health-snapshot.js';
export async function writeHealthSnapshot(
  path: string,
  input: HealthSnapshot,
): Promise<void> {
  const snapshot = parseHealthSnapshot(input);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporary, JSON.stringify(snapshot), {
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporary, path);
  } catch {
    throw new Error('Health snapshot unavailable');
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
interface HealthIo {
  write: (path: string, snapshot: HealthSnapshot) => Promise<void>;
  invalidate: (path: string) => Promise<void>;
}
export class HealthWriter {
  #healthy = false;
  #writtenAt = Number.NEGATIVE_INFINITY;
  #running: Promise<void> | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #stopped = false;
  #started = false;
  constructor(
    private readonly options: {
      path: string;
      writeIntervalMs: number;
      staleMs: number;
    },
    private readonly sample: () => Promise<HealthSnapshot>,
    private readonly io: HealthIo = {
      write: writeHealthSnapshot,
      invalidate: async (path) => {
        await rm(path, { force: true });
      },
    },
  ) {}
  health(): 'up' | 'down' {
    return this.#healthy && Date.now() - this.#writtenAt < this.options.staleMs
      ? 'up'
      : 'down';
  }
  cycle(): Promise<void> {
    if (this.#running) return this.#running;
    if (this.#stopped) return Promise.resolve();
    this.#running = this.runCycle().finally(() => {
      this.#running = undefined;
    });
    return this.#running;
  }
  private async runCycle(): Promise<void> {
    try {
      const snapshot = parseHealthSnapshot(await this.sample());
      if (this.#stopped) return;
      await this.io.write(this.options.path, snapshot);
      if (this.#stopped) {
        await this.io.invalidate(this.options.path).catch(() => undefined);
        return;
      }
      this.#writtenAt = Date.parse(snapshot.writtenAt);
      this.#healthy = true;
    } catch {
      this.#healthy = false;
      await this.io.invalidate(this.options.path).catch(() => undefined);
    }
  }
  start(): void {
    const next = async () => {
      await this.cycle();
      if (!this.#stopped)
        this.#timer = setTimeout(() => {
          void next();
        }, this.options.writeIntervalMs);
    };
    if (this.#started || this.#stopped) return;
    this.#started = true;
    void next();
  }
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#healthy = false;
    clearTimeout(this.#timer);
    // A hung sampler must not prevent shutdown invalidation. Its eventual result is discarded.
    await this.io.invalidate(this.options.path).catch(() => undefined);
  }
}
