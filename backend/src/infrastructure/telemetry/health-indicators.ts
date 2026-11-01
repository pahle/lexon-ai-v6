import { HealthIndicatorService } from '@nestjs/terminus';
import type { RuntimeName } from '../../config/runtime-config.js';
import type { DependencyName, DependencyStatus } from './health-snapshot.js';
interface Probe {
  check(): Promise<'up' | 'down'>;
}
interface Ports {
  database: Probe;
  valkey: () => Promise<{
    queue: 'up' | 'down';
    streams: 'up' | 'down';
    limiter: 'up' | 'down';
  }>;
  storage?: Probe;
  auth?: Probe;
}
export class HealthIndicators {
  readonly #pending = new Map<string, Promise<unknown>>();
  private once<T>(key: string, run: () => Promise<T>): Promise<T> {
    let pending = this.#pending.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = Promise.resolve().then(run);
      this.#pending.set(key, pending);
      const clear = () => {
        if (this.#pending.get(key) === pending) this.#pending.delete(key);
      };
      void pending.then(clear, clear);
    }
    return pending;
  }

  constructor(
    private readonly ports: Ports,
    private readonly timeoutMs: number,
    private readonly indicators = new HealthIndicatorService(),
  ) {}
  async check(runtime: RuntimeName): Promise<DependencyStatus> {
    // Start one policy request, but consume it within bounded Terminus attempts.
    const valkey = this.once('valkey', () => this.ports.valkey());
    const checks: [DependencyName, () => Promise<'up' | 'down'>][] = [
      [
        'postgres',
        () => this.once('postgres', () => this.ports.database.check()),
      ],
      ...(['queue', 'streams', 'limiter'] as const).map(
        (key) =>
          [key, async () => (await valkey)[key]] as [
            DependencyName,
            () => Promise<'up' | 'down'>,
          ],
      ),
    ];
    if (runtime === 'api' || runtime === 'document-worker')
      checks.push([
        'storage',
        async () =>
          this.ports.storage
            ? this.once('storage', () => this.ports.storage!.check())
            : 'down',
      ]);
    if (runtime === 'api' && this.ports.auth)
      checks.push([
        'auth',
        () => this.once('auth', () => this.ports.auth!.check()),
      ]);
    const result: DependencyStatus = {};
    await Promise.all(
      checks.map(async ([key, probe]) => {
        const checked = await this.indicators
          .check(key)
          .attempt(async () => {
            if ((await probe()) !== 'up')
              throw new Error('Dependency unavailable');
          })
          .withTimeout(this.timeoutMs);
        result[key] = checked[key].status === 'up' ? 'up' : 'down';
      }),
    );
    return result;
  }
}
