import { expect } from 'vitest';
import * as os from 'node:os';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import { explainChatSearch } from '../../src/infrastructure/db/testing/chat-search-benchmark.js';

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
    const artifactPath = resolve(
      testRoot,
      'test-results/f4-search',
      `gate-${new Date().toISOString().replaceAll(':', '-')}-${process.pid}.jsonl`,
    );
    await mkdir(dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, '', 'utf8');
    const record = async (value: unknown) => {
      await appendFile(artifactPath, `${JSON.stringify(value)}\n`, 'utf8');
    };
    const sourceFiles = [
      'backend/drizzle/0035_chat_search.sql',
      'backend/drizzle/0036_chat_search_vectors.sql',
      'backend/src/infrastructure/db/chat-search.repository.ts',
      'backend/src/infrastructure/db/schema.ts',
      'backend/src/infrastructure/db/testing/chat-search-benchmark.ts',
      'backend/src/infrastructure/db/testing/chat-fixture.ts',
      'backend/src/modules/chat/chat-search.service.ts',
      'backend/test/integration/chat-search-performance.spec.ts',
    ];
    const sourceHashes = Object.fromEntries(
      await Promise.all(
        sourceFiles.map(async (path) => [
          path,
          createHash('sha256')
            .update(await readFile(resolve(testRoot, path)))
            .digest('hex'),
        ]),
      ),
    );
    const hardware = {
      platform: `${os.platform()} ${os.release()}`,
      architecture: os.arch(),
      cpuModel: os.cpus()[0]?.model,
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      dockerVm: {
        cpuCount: 10,
        memoryBytes: 8_217_059_328,
        containerLimits: 'unlimited within Docker Desktop VM',
      },
    };
    await record({
      type: 'header',
      artifactPath,
      testCommand:
        'pnpm exec vitest run --project backend-integration chat-search-performance.spec',
      configuredApiStatementTimeoutMs: 10_000,
      plannerSeqscanSetting: 'on',
      hardware,
      sourceHashes,
    });
    const app = await createTestApi(
      loadRuntimeConfig(
        'api',
        createAuthEnvironment(
          services,
          '/tmp/lexon-chat-search-performance-health.json',
        ),
      ),
    );
    const fixture = await createChatFixture(services);
    try {
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
        hardware,
        sourceHashes,
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
        [...timings.entries()].map(([name, samples]) => [
          name,
          samples.length === 30 &&
          samples.every((sample) => sample.status === 200)
            ? summarizeTimings(samples)
            : {
                samples: samples.length,
                complete: false,
                failedSamples: samples.filter((sample) => sample.status !== 200)
                  .length,
              },
        ]),
      );
      await record({
        type: 'performance-summary',
        metrics,
        complete:
          timings.size === queryTypes.length &&
          [...timings.values()].every((samples) => samples.length === 30),
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
        expect(summary.samples, `${name} sample count`).toBe(30);
        expect(
          'p95Ms' in summary,
          `${name} lacks a complete p95; see ${artifactPath}`,
        ).toBe(true);
        if ('p95Ms' in summary)
          expect(
            summary.p95Ms,
            `${name} p95; see ${artifactPath}`,
          ).toBeLessThan(300);
      }
    } finally {
      await app.close();
      await fixture.close();
    }
  },
);

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
  type Node = {
    'Node Type'?: string;
    'Relation Name'?: string;
    'Index Name'?: string;
    'Index Cond'?: string;
    Filter?: string;
    'Subplan Name'?: string;
    'CTE Name'?: string;
    'Actual Rows'?: number;
    'Actual Loops'?: number;
    'Plan Rows'?: number;
    'Plan Width'?: number;
    Plans?: Node[];
  };
  type Output = {
    Plan?: Node;
    'Planning Time'?: number;
    'Execution Time'?: number;
  };
  const output = (result.plan.rows[0] as { 'QUERY PLAN': Output[] })[
    'QUERY PLAN'
  ][0]!;
  const flatten = (node: Node): PlanSummaryNode[] => [
    {
      nodeType: node['Node Type'],
      relationName: node['Relation Name'],
      indexName: node['Index Name'],
      indexCond: sanitizePlanText(node['Index Cond']),
      filter: sanitizePlanText(node.Filter),
      subplanName: node['Subplan Name'],
      cteName: node['CTE Name'],
      actualRows: node['Actual Rows'],
      actualLoops: node['Actual Loops'],
      planRows: node['Plan Rows'],
      planWidth: node['Plan Width'],
    },
    ...(node.Plans ?? []).flatMap(flatten),
  ];
  return {
    session: result.session,
    settings: result.settings,
    planningMs: output['Planning Time'],
    executionMs: output['Execution Time'],
    nodes: output.Plan ? flatten(output.Plan) : [],
  };
}

interface PlanSummaryNode {
  nodeType?: string | undefined;
  relationName?: string | undefined;
  indexName?: string | undefined;
  indexCond?: string | undefined;
  filter?: string | undefined;
  subplanName?: string | undefined;
  cteName?: string | undefined;
  actualRows?: number | undefined;
  actualLoops?: number | undefined;
  planRows?: number | undefined;
  planWidth?: number | undefined;
}

function sanitizePlanText(value: string | undefined): string | undefined {
  return value?.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu,
    '<uuid>',
  );
}

function assertOwnerFirstPlan(plan: ReturnType<typeof summarizePlan>) {
  expect(plan.session.role).toBe('lexon_app');
  expect(plan.session.tenantOrgSet).toBe(true);
  expect(plan.session.tenantUserSet).toBe(true);
  expect(plan.session.enableSeqscan).toBe('on');
  const ownerIndex = plan.nodes.find(
    (node) => node.indexName === 'chats_owner_activity',
  );
  expect(ownerIndex, 'owner-scoped chat B-tree missing').toBeDefined();
  expect(ownerIndex?.indexCond).toContain('org_id');
  expect(ownerIndex?.indexCond).toContain('owner_user_id');
  expect(
    plan.nodes.some((node) => node.subplanName?.includes('owner_chats')),
  ).toBe(true);
  expect(
    plan.nodes.some(
      (node) =>
        node.nodeType === 'Seq Scan' &&
        ['chats', 'chat_messages', 'ai_runs'].includes(node.relationName ?? ''),
    ),
  ).toBe(false);
  const messages = plan.nodes.filter(
    (node) => node.relationName === 'chat_messages',
  );
  expect(messages.length).toBeGreaterThan(0);
  expect(messages.every((node) => node.indexName !== undefined)).toBe(true);
}
