export interface SearchSample {
  readonly status: number;
  readonly elapsedMs: number;
}

export interface SearchClassSummary {
  readonly count: number;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly maxMs: number | null;
  readonly statusCounts: Readonly<Record<string, number>>;
}

export function isCompleteSearchRun(
  samplesByClass: ReadonlyMap<string, readonly SearchSample[]>,
  expectedClasses: readonly string[],
  expectedSampleCount: number,
): boolean {
  return (
    samplesByClass.size === expectedClasses.length &&
    expectedClasses.every((queryClass) => {
      const samples = samplesByClass.get(queryClass);
      return (
        samples?.length === expectedSampleCount &&
        samples.every((sample) => sample.status === 200)
      );
    })
  );
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function pick<T extends string | number | null>(
  source: Record<string, unknown>,
  key: string,
  type: 'string' | 'number',
): T {
  const value = source[key];
  if (type === 'string') return (typeof value === 'string' ? value : null) as T;
  return (
    typeof value === 'number' && Number.isFinite(value) ? value : null
  ) as T;
}

/** Return resource metadata from the explicit allow-list; never spread source objects. */
export function whitelistRuntimeEvidence(input: unknown) {
  const value = object(input);
  const runner = object(value.runner);
  const docker = object(value.docker);
  const postgres = object(value.postgres);
  const hostConfig = object(postgres.hostConfig);
  const cgroups = object(postgres.cgroups);

  return {
    runner: {
      image: pick(runner, 'image', 'string'),
      imageOS: pick(runner, 'imageOS', 'string'),
      imageVersion: pick(runner, 'imageVersion', 'string'),
      platform: pick(runner, 'platform', 'string'),
      architecture: pick(runner, 'architecture', 'string'),
      cpuModel: pick(runner, 'cpuModel', 'string'),
      cpuCount: pick(runner, 'cpuCount', 'number'),
      totalMemoryBytes: pick(runner, 'totalMemoryBytes', 'number'),
    },
    docker: {
      serverVersion: pick(docker, 'serverVersion', 'string'),
      cpuCount: pick(docker, 'cpuCount', 'number'),
      memoryBytes: pick(docker, 'memoryBytes', 'number'),
      cgroupDriver: pick(docker, 'cgroupDriver', 'string'),
      cgroupVersion: pick(docker, 'cgroupVersion', 'string'),
    },
    postgres: {
      image: pick(postgres, 'image', 'string'),
      hostConfig: {
        memoryBytes: pick(hostConfig, 'memoryBytes', 'number'),
        nanoCpus: pick(hostConfig, 'nanoCpus', 'number'),
        cpuQuota: pick(hostConfig, 'cpuQuota', 'number'),
        cpuPeriod: pick(hostConfig, 'cpuPeriod', 'number'),
        cpuShares: pick(hostConfig, 'cpuShares', 'number'),
        cpusetCpus: pick(hostConfig, 'cpusetCpus', 'string'),
        pidsLimit: pick(hostConfig, 'pidsLimit', 'number'),
      },
      cgroups: {
        cpuMax: pick(cgroups, 'cpuMax', 'string'),
        memoryMaxBytes: pick(cgroups, 'memoryMaxBytes', 'number'),
        cpusetCpusEffective: pick(cgroups, 'cpusetCpusEffective', 'string'),
        pidsMax: pick(cgroups, 'pidsMax', 'number'),
      },
    },
  };
}

export function summarizeSearchSamples(
  samples: readonly SearchSample[],
): SearchClassSummary {
  const sorted = samples
    .map((sample) => sample.elapsedMs)
    .sort((left, right) => left - right);
  const statusCounts: Record<string, number> = {};
  for (const sample of samples)
    statusCounts[String(sample.status)] =
      (statusCounts[String(sample.status)] ?? 0) + 1;

  const percentile = (fraction: number): number | null =>
    sorted.length
      ? sorted[
          Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
        ]!
      : null;
  return {
    count: samples.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted.at(-1) ?? null,
    statusCounts: Object.fromEntries(
      Object.entries(statusCounts).sort(([left], [right]) =>
        left.localeCompare(right, undefined, { numeric: true }),
      ),
    ),
  };
}

export function formatSearchClassSummary(
  queryClass: string,
  summary: SearchClassSummary,
): string {
  const statuses = Object.entries(summary.statusCounts)
    .map(([status, count]) => `${status}:${count}`)
    .join(',');
  return [
    'F4_SEARCH_CLASS',
    queryClass,
    `count=${summary.count}`,
    `status=${statuses || 'none'}`,
    `p50Ms=${summary.p50Ms ?? 'n/a'}`,
    `p95Ms=${summary.p95Ms ?? 'n/a'}`,
    `maxMs=${summary.maxMs ?? 'n/a'}`,
  ].join(' ');
}

export function selectPostgresContainerId(
  containers: readonly { readonly id: string; readonly ports: string }[],
  mappedPort: number,
): string {
  const suffix = `:${mappedPort}->5432/tcp`;
  const matches = containers.filter((container) =>
    container.ports.split(',').some((port) => port.trim().endsWith(suffix)),
  );
  if (matches.length !== 1)
    throw new Error(
      'Expected exactly one PostgreSQL container for mapped port',
    );
  return matches[0]!.id;
}
