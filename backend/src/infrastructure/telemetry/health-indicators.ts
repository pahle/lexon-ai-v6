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
}
export class HealthIndicators {
  constructor(
    private readonly ports: Ports,
    private readonly timeoutMs: number,
    private readonly indicators = new HealthIndicatorService(),
  ) {}
  async check(runtime: RuntimeName): Promise<DependencyStatus> {
    // Start one policy request, but consume it within bounded Terminus attempts.
    const valkey = Promise.resolve().then(() => this.ports.valkey());
    const checks: [DependencyName, () => Promise<'up' | 'down'>][] = [
      ['postgres', () => this.ports.database.check()],
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
        async () => (this.ports.storage ? this.ports.storage.check() : 'down'),
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
