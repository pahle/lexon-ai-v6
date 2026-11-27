import { expect } from 'vitest';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createPlatformPools } from '../../src/infrastructure/db/testing/platform-console-fixture.js';
import { withAppTenant } from '../../src/infrastructure/db/testing/project-fixture.js';
import {
  chatReadWhere,
  explainListSurface,
  formatListGateMarkdown,
  listGateSurfaces,
  LIST_GATE_POLICY,
} from '../../src/infrastructure/db/testing/project-list-benchmark.js';

const testRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const GATE_INDEXES = [
  'projects_org_activity',
  'projects_org_name',
  'project_members_user',
  'project_denies_pkey',
  'project_members_pkey',
  'chat_shares_user',
  'chats_owner_activity',
  'chats_org_project',
];

test(
  'F6 list gate: matters/org/chats surfaces hold index plans and p95 targets on the 500-project/50-member org',
  { timeout: 900_000 },
  async ({ services }) => {
    const artifactPath = resolve(
      testRoot,
      `docs/references/F6-list-gate-${new Date().toISOString().slice(0, 10)}.jsonl`,
    );
    await mkdir(dirname(artifactPath), { recursive: true });
    const record = async (value: unknown) => {
      await appendFile(artifactPath, `${JSON.stringify(value)}\n`, 'utf8');
    };
    await record({
      type: 'benchmark-start',
      policy: LIST_GATE_POLICY,
    });
    let stage = 'api-setup';
    let app: Awaited<ReturnType<typeof createTestApi>> | undefined;
    const pools = createPlatformPools(services);
    try {
      await record({
        type: 'runtime-evidence',
        appUrl: services.appUrl,
        postgres: 'testcontainers',
      });
      app = await createTestApi(
        loadRuntimeConfig(
          'api',
          createAuthEnvironment(
            services,
            '/tmp/lexon-project-list-performance-health.json',
          ),
        ),
      );
      await app.listen(0, '127.0.0.1');
      const origin = await app.getUrl();
      const actor = await apiHeaders(app);
      const actorId = (await readIdentity(origin, actor)).userId;

      stage = 'seed';
      const orgId = randomUUID();
      // The team-owner invariant is a deferred constraint trigger — the org,
      // users and member rows must land in one transaction.
      const orgClient = await pools.migrator.connect();
      let gateAdmin: string;
      try {
        await orgClient.query('BEGIN');
        await orgClient.query(
          `INSERT INTO auth.organization(id,name,slug,created_at,kind,state)
           VALUES ($1,'Gate Team',$2,clock_timestamp(),'team','active')`,
          [orgId, `gate-${randomUUID()}`],
        );
        const members = await orgClient.query<{ id: string }>(
          `INSERT INTO auth."user"(id,name,email,email_verified,created_at,updated_at,onboarding_complete,pending_admin_activation)
           SELECT gen_random_uuid(),'Gate member '||g,'gate-member-'||g||'@example.test',true,clock_timestamp(),clock_timestamp(),true,false
           FROM generate_series(1,49) g RETURNING id`,
        );
        gateAdmin = members.rows[0]!.id;
        await orgClient.query(
          `INSERT INTO auth.member(organization_id,user_id,role,created_at)
           VALUES ($1,$2,'owner',clock_timestamp())`,
          [orgId, actorId],
        );
        await orgClient.query(
          `INSERT INTO auth.member(organization_id,user_id,role,created_at)
           SELECT $1,id,'member',clock_timestamp() FROM auth."user"
           WHERE email LIKE 'gate-member-%@example.test'`,
          [orgId],
        );
        await orgClient.query('COMMIT');
      } catch (error) {
        await orgClient.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        orgClient.release();
      }
      await pools.migrator.query(
        `INSERT INTO app.projects(id,org_id,owner_user_id,name,matter_number,practice_area,member_count,chat_count,last_activity_at)
         SELECT gen_random_uuid(),$1,$2,'Gate matter '||g,'G-'||g,'litigation',5,2,
                clock_timestamp()-(g||' minutes')::interval
         FROM generate_series(1,500) g`,
        [orgId, actorId],
      );
      // Member rows: the actor on the first 250 projects (mixed roles) and
      // 5 spread members per project (~2500 rows total).
      await pools.migrator.query(
        `INSERT INTO app.project_members(org_id,project_id,user_id,role)
         SELECT p.org_id,p.id,$2,CASE WHEN row_number() OVER ()%2=0 THEN 'editor' ELSE 'viewer' END
         FROM (SELECT * FROM app.projects WHERE org_id=$1 ORDER BY name LIMIT 250) p`,
        [orgId, actorId],
      );
      await pools.migrator.query(
        `INSERT INTO app.project_members(org_id,project_id,user_id,role)
         SELECT p.org_id,p.id,u.id,'viewer'
         FROM app.projects p
         JOIN LATERAL (
           SELECT id FROM auth."user"
           WHERE email LIKE 'gate-member-%@example.test'
           ORDER BY md5(p.id::text) LIMIT 5
         ) u ON true
         WHERE p.org_id=$1`,
        [orgId],
      );
      // Denies: 2 rows against the actor (deny must drop those projects from
      // the actor's list) + 8 spread member denies.
      await pools.migrator.query(
        `INSERT INTO app.project_denies(org_id,project_id,user_id,set_by_user_id)
         SELECT p.org_id,p.id,$2,$3
         FROM (SELECT * FROM app.projects WHERE org_id=$1 ORDER BY name OFFSET 400 LIMIT 2) p`,
        [orgId, actorId, gateAdmin],
      );
      await pools.migrator.query(
        `INSERT INTO app.project_denies(org_id,project_id,user_id,set_by_user_id)
         SELECT p.org_id,p.id,m.user_id,$2
         FROM (SELECT * FROM app.projects WHERE org_id=$1 ORDER BY name OFFSET 410 LIMIT 8) p
         JOIN LATERAL (
           SELECT user_id FROM app.project_members pm
           WHERE pm.org_id=p.org_id AND pm.project_id=p.id AND pm.user_id<>$3 LIMIT 1
         ) m ON true`,
        [orgId, gateAdmin, actorId],
      );
      await pools.migrator.query(
        `INSERT INTO app.chats(id,org_id,owner_user_id,title,project_id,last_activity_at)
         SELECT gen_random_uuid(),$1,$2,'gate chat '||g,
                CASE WHEN g%5<3 THEN (SELECT id FROM app.projects WHERE org_id=$1 ORDER BY name OFFSET g%250 LIMIT 1) END,
                clock_timestamp()-(g||' minutes')::interval
         FROM generate_series(1,200) g`,
        [orgId, actorId],
      );
      await pools.migrator.query(
        `INSERT INTO app.chats(id,org_id,owner_user_id,title,project_id,last_activity_at)
         SELECT gen_random_uuid(),$1,
                (SELECT id FROM auth."user" WHERE email LIKE 'gate-member-%@example.test' ORDER BY id OFFSET g%49 LIMIT 1),
                'other chat '||g,
                CASE WHEN g%2=0 THEN (SELECT id FROM app.projects WHERE org_id=$1 ORDER BY name OFFSET 250+(g%50) LIMIT 1) END,
                clock_timestamp()-(g||' minutes')::interval
         FROM generate_series(1,100) g`,
        [orgId],
      );
      await pools.migrator.query(
        `INSERT INTO app.chat_shares(org_id,chat_id,user_id,granted_by_user_id)
         SELECT c.org_id,c.id,$2,c.owner_user_id FROM app.chats c
         WHERE c.org_id=$1 AND c.owner_user_id<>$2 AND c.project_id IS NULL
         ORDER BY c.last_activity_at LIMIT 30`,
        [orgId, actorId],
      );
      const foreignOrg = randomUUID();
      const foreignClient = await pools.migrator.connect();
      try {
        await foreignClient.query('BEGIN');
        await foreignClient.query(
          `INSERT INTO auth.organization(id,name,slug,created_at,kind,state)
           VALUES ($1,'Foreign Team',$2,clock_timestamp(),'team','active')`,
          [foreignOrg, `gate-f-${randomUUID()}`],
        );
        await foreignClient.query(
          `INSERT INTO auth.member(organization_id,user_id,role,created_at)
           VALUES ($1,$2,'owner',clock_timestamp())`,
          [foreignOrg, gateAdmin],
        );
        await foreignClient.query('COMMIT');
      } catch (error) {
        await foreignClient.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        foreignClient.release();
      }
      await pools.migrator.query(
        `INSERT INTO app.projects(id,org_id,owner_user_id,name,matter_number,last_activity_at)
         SELECT gen_random_uuid(),$1,$2,'Foreign matter '||g,'F-'||g,
                clock_timestamp()-(g||' minutes')::interval
         FROM generate_series(1,100) g`,
        [foreignOrg, gateAdmin],
      );
      await pools.migrator.query(
        'ANALYZE app.projects,app.project_members,app.project_denies,app.chats,app.chat_shares,app.project_instructions',
      );
      await record({ type: 'seed-complete', orgId, foreignOrg });

      stage = 'org-switch';
      const switched = await fetch(`${origin}/api/organizations/active`, {
        method: 'POST',
        headers: { ...actor, 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId: orgId }),
      });
      expect(switched.status).toBe(200);
      const ctx = { orgId, userId: actorId };

      stage = 'plans';
      const surfaces = listGateSurfaces(ctx);
      for (const surface of surfaces) {
        const explained = await withAppTenant(pools.app, ctx, (client) =>
          explainListSurface({ client, ctx }, surface, {
            relations: [
              'app.projects',
              'app.project_members',
              'app.project_denies',
              'app.chats',
              'app.chat_shares',
            ],
            indexNames: GATE_INDEXES,
          }),
        );
        const summary = summarizePlan(explained);
        await record({
          type: 'list-plan',
          surface: surface.name,
          session: explained.session,
          rowSecurity: explained.rowSecurity,
          indexes: explained.indexes,
          summary,
        });
        expect(
          summary.seqScans.filter((relation) =>
            ['app.project_members', 'app.project_denies'].includes(relation),
          ),
          `${surface.name} ran a seq scan on a wall table`,
        ).toEqual([]);
        const expected = Array.isArray(surface.expectIndex)
          ? surface.expectIndex
          : [surface.expectIndex];
        expect(
          summary.indexNames.some((index) => expected.includes(index)),
          `${surface.name} used none of ${expected.join(', ')} (saw ${summary.indexNames.join(', ')})`,
        ).toBe(true);
      }

      // §4.2 access definers are plpgsql — not inlinable — so inner-cost
      // evidence is per-call timing plus the PK index proof above.
      stage = 'definer-cost';
      const projectRow = await pools.migrator.query<{ id: string }>(
        `SELECT id FROM app.projects WHERE org_id=$1 ORDER BY name LIMIT 1`,
        [orgId],
      );
      const accessTimings: number[] = [];
      await withAppTenant(pools.app, ctx, async (client) => {
        for (let i = 0; i < 200; i += 1) {
          const started = performance.now();
          await client.query('SELECT ops.lexon_project_access($1,$2,$3)', [
            orgId,
            projectRow.rows[0]!.id,
            actorId,
          ]);
          accessTimings.push(performance.now() - started);
        }
      });
      accessTimings.sort((a, b) => a - b);
      await record({
        type: 'definer-cost',
        calls: accessTimings.length,
        avgMs: Number(
          (
            accessTimings.reduce((a, b) => a + b, 0) / accessTimings.length
          ).toFixed(3),
        ),
        p95Ms: Number(
          accessTimings[
            Math.min(
              accessTimings.length - 1,
              Math.floor(accessTimings.length * 0.95),
            )
          ]!.toFixed(3),
        ),
        maxMs: Number(accessTimings.at(-1)!.toFixed(3)),
      });

      stage = 'measure';
      const classes: Array<{ name: string; url: string }> = [
        {
          name: 'matters-activity',
          url: `${origin}/api/projects?sort=activity&limit=50`,
        },
        {
          name: 'matters-name',
          url: `${origin}/api/projects?sort=name&limit=50`,
        },
        { name: 'org-projects', url: `${origin}/api/org/projects?limit=50` },
        {
          name: 'org-projects-search',
          url: `${origin}/api/org/projects?q=Gate&limit=50`,
        },
        { name: 'chats-own', url: `${origin}/api/chats?limit=50` },
        {
          name: 'chats-shared',
          url: `${origin}/api/chats?scope=shared&limit=50`,
        },
      ];
      const assessments: Record<
        string,
        {
          p95Ms: number | null;
          successfulSamples: number;
          warning: boolean;
          blockingStatus: 'pass' | 'fail';
        }
      > = {};
      for (const cls of classes) {
        for (let i = 0; i < 5; i += 1) await timedRequest(cls.url, actor);
        const timings: number[] = [];
        let failures = 0;
        for (let i = 0; i < LIST_GATE_POLICY.expectedSampleCount; i += 1) {
          const sample = await timedRequest(cls.url, actor);
          if (sample.status === 200) timings.push(sample.ms);
          else failures += 1;
        }
        timings.sort((a, b) => a - b);
        const p95 =
          timings.length > 0
            ? timings[
                Math.min(timings.length - 1, Math.floor(timings.length * 0.95))
              ]!
            : null;
        const assessment = {
          successfulSamples: timings.length,
          failures,
          p95Ms: p95 === null ? null : Number(p95.toFixed(2)),
          warning: p95 !== null && p95 > LIST_GATE_POLICY.warningP95Ms,
          blockingStatus:
            timings.length === LIST_GATE_POLICY.expectedSampleCount &&
            p95 !== null &&
            p95 < LIST_GATE_POLICY.blockingP95Ms
              ? ('pass' as const)
              : ('fail' as const),
        };
        assessments[cls.name] = assessment;
        await record({
          type: 'list-class',
          class: cls.name,
          ...assessment,
          p50Ms:
            timings.length > 0
              ? Number(timings[Math.floor(timings.length / 2)]!.toFixed(2))
              : null,
          maxMs: timings.length > 0 ? Number(timings.at(-1)!.toFixed(2)) : null,
        });
      }
      const gateMarkdown = formatListGateMarkdown(
        assessments,
        LIST_GATE_POLICY,
      );
      await record({ type: 'performance-summary', markdown: gateMarkdown });
      process.stdout.write(`\n${gateMarkdown}\n`);
      if (process.env.GITHUB_STEP_SUMMARY) {
        await appendFile(
          process.env.GITHUB_STEP_SUMMARY,
          `## F6 list gate\n\n${gateMarkdown}\n`,
        );
      }
      for (const [name, assessment] of Object.entries(assessments)) {
        expect(
          assessment.blockingStatus,
          `${name} missed the blocking gate (p95 ${assessment.p95Ms} ms, ${assessment.successfulSamples}/${LIST_GATE_POLICY.expectedSampleCount} samples)`,
        ).toBe('pass');
      }

      stage = 'post-0043-remeasure';
      await remeasure(pools, ctx, record);

      stage = 'project-delete-claim-lane';
      const deleteTimings: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const created = await fetch(`${origin}/api/projects`, {
          method: 'POST',
          headers: { ...actor, 'content-type': 'application/json' },
          body: JSON.stringify({ name: `Delete target ${i}` }),
        });
        expect(created.status === 200 || created.status === 201).toBe(true);
        const body = (await created.json()) as {
          id?: string;
          project?: { id: string };
        };
        const projectId = body.id ?? body.project?.id;
        expect(projectId).toBeTruthy();
        const started = performance.now();
        const deleted = await fetch(`${origin}/api/projects/${projectId}`, {
          method: 'DELETE',
          headers: { ...actor, 'content-type': 'application/json' },
          body: JSON.stringify({ chatCount: 0 }),
        });
        deleteTimings.push(performance.now() - started);
        expect(deleted.status).toBe(204);
      }
      await record({ type: 'project-delete-claim-lane', ms: deleteTimings });

      stage = 'sse-three-run-peak';
      const sse = await measureSsePeak(`${origin}/api/chats/events`, actor, 3);
      await record({ type: 'sse-three-run-peak', ...sse });
      expect(sse.connected).toBe(3);
    } catch (error) {
      await record({
        type: 'benchmark-error',
        stage,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      await app?.close();
      await pools.close();
    }
  },
);

async function readIdentity(
  origin: string,
  headers: Record<string, string>,
): Promise<{ orgId: string; userId: string }> {
  const response = await fetch(`${origin}/api/identity`, { headers });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    user: { id: string };
    organization: { id: string };
  };
  return { orgId: body.organization.id, userId: body.user.id };
}

async function timedRequest(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; ms: number }> {
  const started = performance.now();
  const response = await fetch(url, { headers });
  await response.arrayBuffer();
  return { status: response.status, ms: performance.now() - started };
}

interface PlanNode {
  'Node Type'?: string;
  'Index Name'?: string;
  'Relation Name'?: string;
  Plans?: PlanNode[];
  [key: string]: unknown;
}

function flattenPlan(node: PlanNode): PlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(flattenPlan)];
}

function summarizePlanNodes(node: PlanNode) {
  const nodes = flattenPlan(node);
  const named = (key: 'Index Name' | 'Relation Name' | 'Node Type') => [
    ...new Set(
      nodes
        .map((n) => n[key])
        .filter((v): v is string => typeof v === 'string'),
    ),
  ];
  return {
    nodeTypes: named('Node Type'),
    indexNames: named('Index Name'),
    seqScans: [
      ...new Set(
        nodes
          .filter((n) => n['Node Type'] === 'Seq Scan')
          .map((n) => n['Relation Name'])
          .filter((v): v is string => typeof v === 'string'),
      ),
    ],
    actualMs: node['Actual Total Time'] ?? null,
    totalCost: node['Total Cost'] ?? null,
  };
}

function planRoot(row: unknown): PlanNode {
  const envelope = (row as Record<string, unknown>)['QUERY PLAN'] as Array<{
    Plan: PlanNode;
  }>;
  return envelope[0]!.Plan;
}

function summarizePlan(
  explained: Awaited<ReturnType<typeof explainListSurface>>,
) {
  return summarizePlanNodes(planRoot(explained.plan.rows[0]));
}

async function remeasure(
  pools: ReturnType<typeof createPlatformPools>,
  ctx: { orgId: string; userId: string },
  record: (value: unknown) => Promise<void>,
) {
  // Post-0043 re-measure: the five statements whose pre-project baselines the
  // acceptance doc tracks, run under EXPLAIN (ANALYZE) as lexon_app on the
  // seeded tenant so regression is comparable. A standalone owner run and a
  // member's project-chat run are seeded for the two proof variants.
  const projectChat = (
    await pools.migrator.query<{ id: string; owner: string; project: string }>(
      `SELECT id,owner_user_id AS owner,project_id AS project FROM app.chats
       WHERE org_id=$1 AND owner_user_id<>$2 AND project_id IS NOT NULL
       ORDER BY last_activity_at DESC LIMIT 1`,
      [ctx.orgId, ctx.userId],
    )
  ).rows[0]!;
  await pools.migrator.query(
    `INSERT INTO app.project_members(org_id,project_id,user_id,role)
     VALUES ($1,$2,$3,'viewer') ON CONFLICT DO NOTHING`,
    [ctx.orgId, projectChat.project, projectChat.owner],
  );
  const standaloneRun = randomUUID();
  const memberRun = randomUUID();
  await pools.migrator.query(
    `INSERT INTO app.ai_runs(id,org_id,initiating_user_id,profile_id,profile_version,
       resolved_config,model_id,input_text,status,input_budget_tokens,output_budget_tokens)
     VALUES ($1,$2,$3,'gate-profile',1,'{}','synthetic/test','gate proof','running',1000,1000)`,
    [standaloneRun, ctx.orgId, ctx.userId],
  );
  await pools.migrator.query(
    `INSERT INTO app.ai_runs(id,org_id,initiating_user_id,profile_id,profile_version,
       resolved_config,model_id,input_text,status,input_budget_tokens,output_budget_tokens)
     VALUES ($1,$2,$3,'gate-profile',1,$4,'synthetic/test','gate proof','running',1000,1000)`,
    [
      memberRun,
      ctx.orgId,
      projectChat.owner,
      JSON.stringify({ resourceIds: [projectChat.id] }),
    ],
  );
  await pools.migrator.query(
    `INSERT INTO app.chat_runs(org_id,chat_id,run_id,kind)
     VALUES ($1,$2,$3,'answer')`,
    [ctx.orgId, projectChat.id, memberRun],
  );
  const steps: Record<
    string,
    { committed: string; claimed: string; op: string }
  > = {};
  for (const [name, runId, owner] of [
    ['standalone', standaloneRun, ctx.userId],
    ['member', memberRun, projectChat.owner],
  ] as const) {
    const committed = randomUUID();
    const claimed = randomUUID();
    const op = randomUUID();
    await withAppTenant(
      pools.app,
      { orgId: ctx.orgId, userId: owner },
      async (client) => {
        await client.query(
          `INSERT INTO app.ai_steps(id,org_id,run_id,sequence,expected_version,state,fence)
           VALUES ($1,$2,$3,1,1,'committed',1),($4,$2,$3,2,2,'claimed',1)`,
          [committed, ctx.orgId, runId, claimed],
        );
      },
    );
    await pools.migrator.query(
      `UPDATE app.ai_steps SET lease_until=clock_timestamp()+interval '1 hour'
       WHERE id=$1`,
      [claimed],
    );
    const opClient = await pools.migrator.connect();
    try {
      await opClient.query('BEGIN');
      await opClient.query(`SELECT set_config('app.user_id',$1,true)`, [owner]);
      await opClient.query(
        `INSERT INTO app.ai_operations(id,org_id,run_id,step_id,call_occurrence,tool_name,
         tool_version,idempotency_mode,args,args_hash,snapshot_hash,approval_required,
         status,kind,expires_at)
       VALUES ($1,$2,$3,$4,0,'fixture-tool',1,'read','{}',$5,$6,true,'awaiting_approval','approval',clock_timestamp()+interval '1 hour')`,
        [op, ctx.orgId, runId, committed, 'a'.repeat(64), 'b'.repeat(64)],
      );
      await opClient.query('COMMIT');
    } catch (error) {
      await opClient.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      opClient.release();
    }
    steps[name] = { committed, claimed, op };
  }
  const memberCtx = { orgId: ctx.orgId, userId: projectChat.owner };
  const memberScope = {
    where: (alias: string, orgParam: string, userParam: string) =>
      chatReadWhere(alias, orgParam, userParam, memberCtx),
  };
  const ownerScope = {
    where: (alias: string, orgParam: string, userParam: string) =>
      chatReadWhere(alias, orgParam, userParam, ctx),
  };
  const proofText = (scope: {
    where: (a: string, b: string, c: string) => string;
  }) =>
    `SELECT r.status,r.run_version,r.next_sequence,s.id AS step_id,
        s.sequence,s.expected_version,s.fence,r.stream_generation
     FROM app.ai_runs r JOIN app.ai_steps s ON s.org_id=r.org_id AND s.run_id=r.id
     WHERE r.org_id=$1 AND r.id=$2
       AND (r.initiating_user_id=$3 OR EXISTS (
         SELECT 1 FROM app.chat_runs cr
         JOIN app.chats c ON c.org_id=cr.org_id AND c.id=cr.chat_id
         WHERE cr.org_id=r.org_id AND cr.run_id=r.id AND cr.kind='answer'
           AND ${scope.where('c', '$1', '$3')}))
       AND r.status=$9 AND r.run_version=$8
       AND r.next_sequence >= $4 + 1
       AND s.id=$6 AND s.sequence=$4 AND s.expected_version=$5 AND s.fence=$7
       AND s.state IN ('committed','awaiting_approval')
       AND NOT EXISTS (
         SELECT 1 FROM app.ai_steps newer
         WHERE newer.org_id=s.org_id AND newer.run_id=s.run_id
           AND newer.sequence>s.sequence AND newer.state IN ('committed','awaiting_approval')
       )`;
  const runVersion = (
    await pools.migrator.query<{ v: number; n: number }>(
      `SELECT run_version AS v,next_sequence AS n FROM app.ai_runs WHERE org_id=$1 AND id=$2`,
      [ctx.orgId, standaloneRun],
    )
  ).rows[0]!;
  const memberRunVersion = (
    await pools.migrator.query<{ v: number; n: number }>(
      `SELECT run_version AS v,next_sequence AS n FROM app.ai_runs WHERE org_id=$1 AND id=$2`,
      [ctx.orgId, memberRun],
    )
  ).rows[0]!;
  const statements: Array<{
    name: string;
    text: string;
    params: unknown[];
    rollback: boolean;
    ctxUser: string;
  }> = [
    {
      name: 'streamCommittedProof owner/standalone',
      text: proofText(ownerScope),
      params: [
        ctx.orgId,
        standaloneRun,
        ctx.userId,
        1,
        1,
        steps.standalone!.committed,
        1,
        runVersion.v,
        'running',
      ],
      rollback: false,
      ctxUser: ctx.userId,
    },
    {
      name: 'streamCommittedProof member/project',
      text: proofText(memberScope),
      params: [
        ctx.orgId,
        memberRun,
        projectChat.owner,
        1,
        1,
        steps.member!.committed,
        1,
        memberRunVersion.v,
        'running',
      ],
      rollback: false,
      ctxUser: projectChat.owner,
    },
    {
      name: 'chats.readLive member/project',
      text: `SELECT * FROM app.chats c
       WHERE ${memberScope.where('c', '$1', '$2')} AND c.id=$3`,
      params: [ctx.orgId, projectChat.owner, projectChat.id],
      rollback: false,
      ctxUser: projectChat.owner,
    },
    {
      name: 'ai_steps commit UPDATE',
      text: `UPDATE app.ai_steps s SET state='committed',committed_text='x',commit_data='{}'::jsonb,
       lease_until=NULL,updated_at=clock_timestamp()
       FROM app.ai_runs r
       WHERE s.org_id=$1 AND s.run_id=$2 AND s.id=$3 AND s.sequence=$4 AND s.expected_version=$5
         AND s.fence=$6 AND s.state='claimed' AND s.lease_until>clock_timestamp()
         AND r.org_id=s.org_id AND r.id=s.run_id AND r.run_version=$5 AND r.next_sequence=$4
         AND r.status IN ('queued','running','awaiting_approval')`,
      params: [ctx.orgId, standaloneRun, steps.standalone!.claimed, 2, 2, 1],
      rollback: true,
      ctxUser: ctx.userId,
    },
    {
      name: 'ai_operations decide UPDATE',
      text: `UPDATE app.ai_operations
       SET status='approved',decision='approve',decision_by_user_id=$4,decided_at=clock_timestamp(),
           expires_at=NULL,result=$7::jsonb,
           completed_at=CASE WHEN $6='approve' THEN NULL ELSE clock_timestamp() END
       WHERE org_id=$1 AND run_id=$2 AND id=$3 AND snapshot_hash=$5
         AND approval_required=true AND status='awaiting_approval' AND decision IS NULL
         AND ((kind='approval' AND $6 IN ('approve','reject'))
           OR (kind='question' AND $6 IN ('answer','dismiss')))`,
      params: [
        ctx.orgId,
        standaloneRun,
        steps.standalone!.op,
        ctx.userId,
        'b'.repeat(64),
        'approve',
        null,
      ],
      rollback: true,
      ctxUser: ctx.userId,
    },
  ];
  for (const statement of statements) {
    const samples: number[] = [];
    await withAppTenant(
      pools.app,
      { orgId: ctx.orgId, userId: statement.ctxUser },
      async (client) => {
        for (let i = 0; i < 10; i += 1) {
          if (statement.rollback) await client.query('SAVEPOINT remeasure');
          const started = performance.now();
          const plan = await client.query(
            `EXPLAIN (ANALYZE, FORMAT JSON) ${statement.text}`,
            statement.params,
          );
          samples.push(performance.now() - started);
          if (statement.rollback)
            await client.query('ROLLBACK TO SAVEPOINT remeasure');
          if (i === 0) {
            await record({
              type: 'remeasure-plan',
              statement: statement.name,
              summary: summarizePlanNodes(planRoot(plan.rows[0])),
            });
          }
        }
      },
    );
    samples.sort((a, b) => a - b);
    await record({
      type: 'remeasure',
      statement: statement.name,
      samples: samples.length,
      p50Ms: Number(samples[Math.floor(samples.length / 2)]!.toFixed(2)),
      p95Ms: Number(
        samples[
          Math.min(samples.length - 1, Math.floor(samples.length * 0.95))
        ]!.toFixed(2),
      ),
      maxMs: Number(samples.at(-1)!.toFixed(2)),
    });
  }
}

async function measureSsePeak(
  url: string,
  headers: Record<string, string>,
  count: number,
): Promise<{ connected: number; firstByteMs: number[]; maxMs: number }> {
  const results = await Promise.all(
    Array.from({ length: count }, async () => {
      const started = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch(url, {
          headers: { ...headers, accept: 'text/event-stream' },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          return { connected: false, ms: performance.now() - started };
        }
        const reader = response.body.getReader();
        await reader.read();
        const ms = performance.now() - started;
        reader.cancel().catch(() => undefined);
        return { connected: true, ms };
      } catch {
        return { connected: false, ms: performance.now() - started };
      } finally {
        clearTimeout(timer);
        controller.abort();
      }
    }),
  );
  return {
    connected: results.filter((r) => r.connected).length,
    firstByteMs: results.map((r) => Number(r.ms.toFixed(2))),
    maxMs: Number(Math.max(...results.map((r) => r.ms)).toFixed(2)),
  };
}
