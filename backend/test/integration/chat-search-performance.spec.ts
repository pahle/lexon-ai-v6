import { expect } from 'vitest';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import { explainChatSearch } from '../../src/infrastructure/db/testing/chat-search-benchmark.js';
import {
  formatSearchClassSummary,
  isCompleteSearchRun,
  selectPostgresContainerId,
  summarizeSearchSamples,
  whitelistRuntimeEvidence,
} from '../../src/infrastructure/db/testing/chat-search-evidence.js';

const queryTypes = [
  ['stem', 'agreements'],
  ['partial', 'contrac'],
  ['article', '1320'],
  ['noMatch', `missing-${'a'.repeat(48)}`],
] as const;
const testRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

test(
  'private search performance gate uses owner-first plans and stays under target',
  { timeout: 900_000 },
  async ({ services }) => {
    const artifactPath = resolve(testRoot, 'test-results/f4-search/gate.jsonl');
    await mkdir(dirname(artifactPath), { recursive: true });
    try {
      await readFile(artifactPath);
    } catch {
      await writeFile(
        artifactPath,
        `${JSON.stringify({ type: 'header', sourceHead: null, localRun: true })}\n`,
        'utf8',
      );
    }
    const record = async (value: unknown) => {
      await appendFile(artifactPath, `${JSON.stringify(value)}\n`, 'utf8');
    };
    await record({
      type: 'benchmark-start',
      configuredApiStatementTimeoutMs: 10_000,
    });
    let stage = 'postgres-metadata';
    let app: Awaited<ReturnType<typeof createTestApi>> | undefined;
    let fixture: Awaited<ReturnType<typeof createChatFixture>> | undefined;
    try {
      await record({
        type: 'runtime-evidence',
        evidence: whitelistRuntimeEvidence(
          await captureRuntimeEvidence(services.appUrl),
        ),
      });
      stage = 'api-setup';
      app = await createTestApi(
        loadRuntimeConfig(
          'api',
          createAuthEnvironment(
            services,
            '/tmp/lexon-chat-search-performance-health.json',
          ),
        ),
      );
      stage = 'fixture-setup';
      fixture = await createChatFixture(services);
      stage = 'seed-and-measure';
      await app.listen(0, '127.0.0.1');
      const origin = await app.getUrl();
      const owner = await apiHeaders(app);
      const ownerContext = await readIdentity(origin, owner);
      await fixture.inspect.query(
        'ALTER TABLE app.chat_messages DROP COLUMN search_vector',
      );
      await fixture.inspect.query(
        'ALTER TABLE app.ai_runs DROP COLUMN search_vector',
      );
      const seeded =
        await fixture.chat.seedSearchPerformanceCorpus(ownerContext);
      expect(seeded.chatCount).toBe(2_000);
      expect(seeded.messageCount).toBe(50_000);
      expect(seeded.foreignMessageCount).toBeGreaterThanOrEqual(1_000_000);
      expect(seeded.foreignChatCount).toBeGreaterThanOrEqual(40_000);
      const messageBytesBefore = await fixture.inspect.query(
        `SELECT pg_total_relation_size('app.chat_messages') AS bytes,
                pg_relation_size('app.chat_messages') AS heap_bytes`,
      );
      const runBytesBefore = await fixture.inspect.query(
        `SELECT pg_total_relation_size('app.ai_runs') AS bytes,
                pg_relation_size('app.ai_runs') AS heap_bytes`,
      );
      await record({
        type: 'pre-migration-size',
        messageBytes: messageBytesBefore.rows[0],
        runBytes: runBytesBefore.rows[0],
        seed: seeded,
      });
      const migration = await readFile(
        resolve(testRoot, 'backend/drizzle/0036_chat_search_vectors.sql'),
        'utf8',
      );
      const migrationStatements = migration
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean);
      const migrationCosts = [];
      for (const [index, statement] of migrationStatements.entries()) {
        const started = performance.now();
        await fixture.inspect.query(statement);
        const timing = {
          statementIndex: index,
          elapsedMs: performance.now() - started,
        };
        migrationCosts.push(timing);
        await record({ type: 'migration-alter', ...timing });
      }
      await fixture.inspect.query(
        'ANALYZE app.chats,app.chat_messages,app.ai_runs',
      );
      await record({ type: 'post-migration-analyze', completed: true });
      const messageBytesAfter = await fixture.inspect.query(
        `SELECT pg_total_relation_size('app.chat_messages') AS bytes,
                pg_relation_size('app.chat_messages') AS heap_bytes,
                count(*) AS rows,
                sum(pg_column_size(search_vector)) AS vector_bytes,
                percentile_cont(0.50) WITHIN GROUP (ORDER BY pg_column_size(search_vector)) AS vector_p50_bytes,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY pg_column_size(search_vector)) AS vector_p95_bytes
         FROM app.chat_messages`,
      );
      const runBytesAfter = await fixture.inspect.query(
        `SELECT pg_total_relation_size('app.ai_runs') AS bytes,
                pg_relation_size('app.ai_runs') AS heap_bytes,
                count(*) AS rows,
                sum(pg_column_size(search_vector)) AS vector_bytes,
                percentile_cont(0.50) WITHIN GROUP (ORDER BY pg_column_size(search_vector)) AS vector_p50_bytes,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY pg_column_size(search_vector)) AS vector_p95_bytes
         FROM app.ai_runs`,
      );
      const messageProbe = await fixture.inspect.query(
        "SELECT id FROM app.chat_messages WHERE role='user' LIMIT 1",
      );
      let messageVectorWritePrevented = false;
      try {
        await fixture.inspect.query(
          'UPDATE app.chat_messages SET search_vector=\'"forged"\'::tsvector WHERE id=$1',
          [(messageProbe.rows[0] as { id: string } | undefined)?.id],
        );
      } catch (error) {
        messageVectorWritePrevented =
          (error as { code?: string }).code === '428C9';
      }
      const runProbe = await fixture.inspect.query(
        "SELECT id FROM app.ai_runs WHERE model_id='synthetic/benchmark' LIMIT 1",
      );
      let runVectorWritePrevented = false;
      try {
        await fixture.inspect.query(
          'UPDATE app.ai_runs SET search_vector=\'"forged"\'::tsvector WHERE id=$1',
          [(runProbe.rows[0] as { id: string } | undefined)?.id],
        );
      } catch (error) {
        runVectorWritePrevented = (error as { code?: string }).code === '428C9';
      }
      expect(messageVectorWritePrevented).toBe(true);
      expect(runVectorWritePrevented).toBe(true);
      const serverVersion = await fixture.inspect.query('SHOW server_version');
      await record({
        type: 'migration-cost',
        serverVersion: (serverVersion.rows[0] as { server_version: string })
          .server_version,
        statements: migrationCosts,
        messageBytesBefore: messageBytesBefore.rows[0],
        messageBytesAfter: messageBytesAfter.rows[0],
        runBytesBefore: runBytesBefore.rows[0],
        runBytesAfter: runBytesAfter.rows[0],
        generatedVectorWritePrevented: {
          messages: messageVectorWritePrevented,
          runs: runVectorWritePrevented,
        },
      });

      const planSummaries = [];
      for (const [name, query] of queryTypes) {
        const result = await fixture.database.withTenant(ownerContext, (tx) =>
          explainChatSearch(tx, query, null, 10),
        );
        const summary = summarizePlan(result);
        planSummaries.push(summary);
        await record({ type: 'plan', queryClass: name, plan: summary });
      }
      const runtime = {
        postgresVersion: (
          serverVersion.rows[0] as { server_version: string } | undefined
        )?.server_version,
        appSessionSettings: planSummaries[0]?.settings,
      };
      await record({
        type: 'preflight',
        runtime,
        seed: seeded,
      });
      for (const plan of planSummaries) assertOwnerFirstPlan(plan);

      const timings = new Map<
        string,
        Array<{ status: number; elapsedMs: number; error?: string }>
      >();
      const warmups = new Map<
        string,
        Array<{ status: number; elapsedMs: number; error?: string }>
      >();
      let warmupFailed = false;
      for (const [name, query] of queryTypes) {
        const samples: Array<{
          status: number;
          elapsedMs: number;
          error?: string;
        }> = [];
        for (let index = 0; index < 5; index++) {
          const sample = await requestSearch(origin, owner, query);
          samples.push(sample);
          await record({
            type: 'warmup',
            queryClass: name,
            sampleIndex: index + 1,
            ...sample,
          });
          if (sample.status !== 200) {
            warmupFailed = true;
            break;
          }
        }
        warmups.set(name, samples);
        if (warmupFailed) break;
      }
      const warmupMetrics = Object.fromEntries(
        [...warmups.entries()].map(([name, samples]) => [
          name,
          summarizeTimings(samples),
        ]),
      );
      await record({ type: 'warmup-summary', warmupMetrics });
      if (warmupFailed)
        throw new Error(
          `Search warmup failed; incomplete gate artifact: ${artifactPath}`,
        );

      let requestFailed = false;
      for (const [name, query] of queryTypes) {
        const samples: Array<{
          status: number;
          elapsedMs: number;
          error?: string;
        }> = [];
        for (let index = 0; index < 30; index++) {
          const sample = await requestSearch(origin, owner, query);
          samples.push(sample);
          await record({
            type: 'measurement',
            queryClass: name,
            sampleIndex: index + 1,
            ...sample,
          });
          if (sample.status !== 200) {
            requestFailed = true;
            break;
          }
        }
        timings.set(name, samples);
        if (requestFailed) break;
      }

      const metrics = Object.fromEntries(
        queryTypes.map(([name]) => {
          const samples = timings.get(name) ?? [];
          return [
            name,
            {
              ...summarizeSearchSamples(samples),
              complete:
                samples.length === 30 &&
                samples.every((sample) => sample.status === 200),
            },
          ];
        }),
      );
      for (const [name] of queryTypes)
        console.log(formatSearchClassSummary(name, metrics[name]!));
      await record({
        type: 'performance-summary',
        metrics,
        complete: isCompleteSearchRun(
          timings,
          queryTypes.map(([name]) => name),
          30,
        ),
      });
      console.log(`F4_SEARCH_ARTIFACT ${artifactPath}`);

      expect(
        requestFailed,
        `search measurement failed; see ${artifactPath}`,
      ).toBe(false);
      expect(timings.size, `incomplete measurements; see ${artifactPath}`).toBe(
        queryTypes.length,
      );
      for (const [name, summary] of Object.entries(metrics)) {
        expect(summary.count, `${name} sample count`).toBe(30);
        expect(
          summary.p95Ms,
          `${name} lacks a complete p95; see ${artifactPath}`,
        ).not.toBeNull();
        expect(summary.p95Ms, `${name} p95; see ${artifactPath}`).toBeLessThan(
          500,
        );
      }
    } catch (error) {
      await record({
        type: 'failure',
        stage,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    } finally {
      await app?.close();
      await fixture?.close();
    }
  },
);

async function captureRuntimeEvidence(appUrl: string) {
  const dockerInfo = JSON.parse(
    dockerOutput(['info', '--format', '{{json .}}']),
  ) as Record<string, unknown>;
  const mappedPort = Number(new URL(appUrl).port);
  const listedContainers = dockerOutput([
    'ps',
    '--format',
    '{{.ID}}\t{{.Ports}}',
  ]);
  const candidates = listedContainers
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [id, ports = ''] = line.split('\t');
      return { id: id!, ports };
    });
  const containerId = selectPostgresContainerId(candidates, mappedPort);
  const inspectRows = JSON.parse(
    dockerOutput(['inspect', containerId]),
  ) as Array<Record<string, unknown>>;
  const inspect = inspectRows[0];
  if (!inspect) throw new Error('PostgreSQL container inspection was empty');
  const hostConfig = (inspect.HostConfig ?? {}) as Record<string, unknown>;
  const config = (inspect.Config ?? {}) as Record<string, unknown>;
  const cgroupValue = (name: string) => {
    try {
      return dockerOutput([
        'exec',
        containerId,
        'cat',
        `/sys/fs/cgroup/${name}`,
      ]);
    } catch {
      return null;
    }
  };
  const memoryLimit = cgroupValue('memory.max');
  const pidsLimit = cgroupValue('pids.max');
  const numericLimit = (value: string | null) =>
    value && value !== 'max' && Number.isFinite(Number(value))
      ? Number(value)
      : null;
  const cpus = os.cpus();
  return {
    runner: {
      image: process.env.F4_RUNNER_IMAGE ?? null,
      imageOS: process.env.ImageOS ?? null,
      imageVersion: process.env.ImageVersion ?? null,
      platform: `${os.platform()} ${os.release()}`,
      architecture: os.arch(),
      cpuModel: cpus[0]?.model ?? null,
      cpuCount: cpus.length,
      totalMemoryBytes: os.totalmem(),
    },
    docker: {
      serverVersion: dockerInfo.ServerVersion,
      cpuCount: dockerInfo.NCPU,
      memoryBytes: dockerInfo.MemTotal,
      cgroupDriver: dockerInfo.CgroupDriver,
      cgroupVersion: dockerInfo.CgroupVersion,
    },
    postgres: {
      image: config.Image,
      hostConfig: {
        memoryBytes: hostConfig.Memory,
        nanoCpus: hostConfig.NanoCpus,
        cpuQuota: hostConfig.CpuQuota,
        cpuPeriod: hostConfig.CpuPeriod,
        cpuShares: hostConfig.CpuShares,
        cpusetCpus: hostConfig.CpusetCpus,
        pidsLimit: hostConfig.PidsLimit,
      },
      cgroups: {
        cpuMax: cgroupValue('cpu.max'),
        memoryMaxBytes: numericLimit(memoryLimit),
        cpusetCpusEffective: cgroupValue('cpuset.cpus.effective'),
        pidsMax: numericLimit(pidsLimit),
      },
    },
  };
}

function dockerOutput(args: string[]): string {
  try {
    return execFileSync('docker', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim();
  } catch {
    throw new Error('Docker resource metadata could not be collected');
  }
}

async function readIdentity(
  origin: string,
  headers: Record<string, string>,
): Promise<{ orgId: string; userId: string }> {
  const response = await fetch(`${origin}/api/identity`, { headers });
  const body = (await response.json()) as {
    user: { id: string };
    organization: { id: string };
  };
  return { orgId: body.organization.id, userId: body.user.id };
}

async function requestSearch(
  origin: string,
  headers: Record<string, string>,
  query: string,
) {
  const started = performance.now();
  try {
    const response = await fetch(`${origin}/api/chats/search`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ query, limit: 10 }),
    });
    await response.arrayBuffer();
    return { status: response.status, elapsedMs: performance.now() - started };
  } catch (error) {
    return {
      status: 0,
      elapsedMs: performance.now() - started,
      error: error instanceof Error ? error.name : 'unknown',
    };
  }
}

function summarizeTimings(
  samples: Array<{ status: number; elapsedMs: number; error?: string }>,
) {
  const sorted = samples
    .map((sample) => sample.elapsedMs)
    .sort((a, b) => a - b);
  return {
    samples: samples.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1) ?? 0,
    failedSamples: samples.filter((sample) => sample.status !== 200).length,
    errors: [
      ...new Set(
        samples.flatMap((sample) => (sample.error ? [sample.error] : [])),
      ),
    ],
  };
}

function percentile(sorted: readonly number[], fraction: number): number {
  return (
    sorted[
      Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
    ] ?? 0
  );
}

function summarizePlan(result: Awaited<ReturnType<typeof explainChatSearch>>) {
  type Output = {
    Plan?: Record<string, unknown>;
    'Planning Time'?: number;
    'Execution Time'?: number;
  };
  const output = (result.plan.rows[0] as { 'QUERY PLAN': Output[] })[
    'QUERY PLAN'
  ][0]!;
  return {
    session: result.session,
    settings: result.settings,
    ownerIndexPredicate: result.ownerIndexPredicate,
    rowSecurity: result.rowSecurity,
    planningMs: output['Planning Time'],
    executionMs: output['Execution Time'],
    planTree: output.Plan ? sanitizePlanValue(output.Plan) : null,
  };
}

function sanitizePlanValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizePlanValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        sanitizePlanValue(entry),
      ]),
    );
  if (typeof value === 'string')
    return value.replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu,
      '<uuid>',
    );
  return value;
}

function assertOwnerFirstPlan(plan: ReturnType<typeof summarizePlan>) {
  expect(plan.session.role).toBe('lexon_app');
  expect(plan.session.tenantOrgSet).toBe(true);
  expect(plan.session.tenantUserSet).toBe(true);
  expect(plan.session.enableSeqscan).toBe('on');
  expect(
    plan.rowSecurity.map((table) => [
      table.relation,
      table.enabled,
      table.forced,
    ]),
  ).toEqual([
    ['app.ai_runs', true, true],
    ['app.chat_messages', true, true],
    ['app.chats', true, true],
  ]);
  expect(plan.ownerIndexPredicate).toMatch(/deleted_at IS NULL/i);
  const root = plan.planTree as PlanNode;
  const ownerCte = findPlanPath(root, (node) =>
    String(node['Subplan Name']).includes('owner_chats'),
  );
  expect(ownerCte, 'owner_chats CTE subtree missing').toBeDefined();
  const ownerIndexPath = ownerCte
    ? findPlanPath(
        ownerCte.node,
        (node) => String(node['Index Name']) === 'chats_owner_activity',
      )
    : undefined;
  expect(
    ownerIndexPath,
    'owner index must be below owner_chats CTE',
  ).toBeDefined();
  const ownerIndex = ownerIndexPath?.node;
  expect(ownerIndex, 'owner-scoped chat B-tree missing').toBeDefined();
  expect(String(ownerIndex?.['Index Cond'])).toContain('org_id');
  expect(String(ownerIndex?.['Index Cond'])).toContain('owner_user_id');
  expect(
    ownerIndexPath?.path.some(
      (node) =>
        node['Relation Name'] === 'chats' &&
        ['Bitmap Heap Scan', 'Index Scan'].includes(String(node['Node Type'])),
    ),
  ).toBe(true);
  const allNodes = flattenPlan(root);
  expect(
    allNodes.some(
      (node) =>
        node['Node Type'] === 'Seq Scan' &&
        ['chats', 'chat_messages', 'ai_runs'].includes(
          String(node['Relation Name']),
        ),
    ),
  ).toBe(false);
  const messages = allNodes.filter(
    (node) => node['Relation Name'] === 'chat_messages',
  );
  expect(messages.length).toBeGreaterThan(0);
}

type PlanNode = Record<string, unknown> & { Plans?: PlanNode[] };

function flattenPlan(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flattenPlan)];
}

function findPlanPath(
  root: PlanNode,
  matches: (node: PlanNode) => boolean,
  path: PlanNode[] = [],
): { node: PlanNode; path: PlanNode[] } | undefined {
  const nextPath = [...path, root];
  if (matches(root)) return { node: root, path: nextPath };
  for (const child of root.Plans ?? []) {
    const found = findPlanPath(child, matches, nextPath);
    if (found) return found;
  }
  return undefined;
}
