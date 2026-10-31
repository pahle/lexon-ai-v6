import { z } from 'zod';
export const dependencyNames = [
  'postgres',
  'queue',
  'streams',
  'limiter',
  'storage',
] as const;
export type DependencyName = (typeof dependencyNames)[number];
export type DependencyStatus = Partial<Record<DependencyName, 'up' | 'down'>>;
const schema = z
  .strictObject({
    status: z.enum(['active', 'standby', 'unhealthy']),
    liveness: z.enum(['up', 'down']),
    readiness: z.enum(['up', 'down']),
    writtenAt: z.iso.datetime(),
    dependencies: z.partialRecord(
      z.enum(dependencyNames),
      z.enum(['up', 'down']),
    ),
  })
  .refine(
    (value) =>
      value.readiness === 'down' ||
      (value.liveness === 'up' &&
        value.status !== 'unhealthy' &&
        Object.values(value.dependencies).every((status) => status === 'up')),
  );
export type HealthSnapshot = z.infer<typeof schema>;
export function parseHealthSnapshot(input: unknown): HealthSnapshot {
  const result = schema.safeParse(input);
  if (!result.success) throw new Error('Invalid health snapshot');
  return result.data;
}
// Only the owning work loop advances this heartbeat, never the health timer.
export class ProgressHeartbeat {
  #lastProgress = Number.NEGATIVE_INFINITY;
  constructor(private readonly staleMs: number) {}
  beat(now = new Date()): void {
    this.#lastProgress = now.getTime();
  }
  isAlive(now = new Date()): boolean {
    return now.getTime() - this.#lastProgress < this.staleMs;
  }
}
