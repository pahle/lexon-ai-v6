import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createChatFixture } from '../../src/infrastructure/db/testing/chat-fixture.js';
import {
  buildAuthorizationPredicate,
  requireSession,
  treeSql,
  validatorSql,
} from '../../src/infrastructure/db/index.js';

// F4.4 hardening (spec §5 item 15, cost record): the validator must be
// clearly cheaper than the tree read. This spec seeds one synthetic chat —
// 500 messages, 50 runs with steps, attempts, checkpoints and feedback — then
// EXPLAIN ANALYZE BUFFERS both queries under the real tenant role and writes
// test-results/f44-etag-cost.json. It runs only under LEXON_RECORD_COST=1.

const CHILD_TABLES = [
  'chat_messages',
  'chat_runs',
  'ai_runs',
  'ai_checkpoints',
  'ai_steps',
  'ai_attempts',
  'message_feedback',
] as const;

interface PlanNode {
  'Node Type'?: string;
  'Relation Name'?: string;
  Plans?: PlanNode[];
}

interface ExplainResult {
  Plan: PlanNode & { 'Actual Total Time'?: number };
  'Planning Time'?: number;
  'Execution Time'?: number;
}

function seqScans(plan: PlanNode, into: string[] = []): string[] {
  if (plan['Node Type'] === 'Seq Scan' && plan['Relation Name'] !== undefined) {
    into.push(plan['Relation Name']);
  }
  for (const child of plan.Plans ?? []) seqScans(child, into);
  return into;
}

async function explain(
  query: (
    sql: string,
    params: readonly unknown[],
  ) => Promise<{ rows: unknown[] }>,
  sql: string,
  params: readonly unknown[],
): Promise<ExplainResult> {
  const result = await query(
    `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
    params,
  );
  const row = result.rows[0] as { 'QUERY PLAN': ExplainResult[] };
  return row['QUERY PLAN'][0]!;
}

describe.skipIf(!process.env.LEXON_RECORD_COST)(
  'chat tree validator cost record',
  () => {
    test('EXPLAIN ANALYZE BUFFERS: validator is clearly cheaper than the tree read', async ({
      services,
    }) => {
      const app = await createTestApi(
        loadRuntimeConfig(
          'api',
          createAuthEnvironment(
            services,
            '/tmp/lexon-chat-etag-cost-health.json',
          ),
        ),
      );
      const fixture = await createChatFixture(services);
      try {
        await app.listen(0, '127.0.0.1');
        const origin = await app.getUrl();
        const headers = await apiHeaders(app);
        const identity = (await (
          await fetch(`${origin}/api/identity`, { headers })
        ).json()) as { user: { id: string }; organization: { id: string } };
        const ctx = {
          orgId: identity.organization.id,
          userId: identity.user.id,
        };

        const chatId = randomUUID();
        const userIds = Array.from({ length: 450 }, () => randomUUID());
        const assistantIds = Array.from({ length: 50 }, () => randomUUID());
        const runIds = Array.from({ length: 50 }, () => randomUUID());
        const stepIds = Array.from({ length: 50 }, () => randomUUID());
        const attemptIds = Array.from({ length: 50 }, () => randomUUID());

        await fixture.database.withTenant(ctx, async (tx) => {
          const { client } = requireSession(tx);
          await client.query(
            `INSERT INTO app.chats(id,org_id,owner_user_id,title,title_version)
               VALUES ($1,$2,$3,'etag cost corpus',1)`,
            [chatId, ctx.orgId, ctx.userId],
          );
          await client.query(
            `INSERT INTO app.chat_messages(id,org_id,chat_id,role,user_text,effort)
               SELECT data.id,$1,$2,'user','cost corpus question','high'
               FROM unnest($3::uuid[]) AS data(id)`,
            [ctx.orgId, chatId, userIds],
          );
          // The RLS owner-resource policy admits a run with a resourceId
          // only while queued-and-unlinked or owner-linked to a live chat,
          // and the link guard admits one queued answer at a time — so link
          // each queued run then complete it before linking the next.
          await client.query(
            `INSERT INTO app.ai_runs(
                 id,org_id,initiating_user_id,profile_id,profile_version,
                 resolved_config,model_id,input_text,status,
                 input_budget_tokens,output_budget_tokens)
               SELECT data.id,$1,$2,'chat',1,
                 jsonb_build_object('resourceIds',jsonb_build_array($4::text)),
                 'synthetic/cost','cost prompt','queued',1024,4096
               FROM unnest($3::uuid[]) AS data(id)`,
            [ctx.orgId, ctx.userId, runIds, chatId],
          );
          for (const runId of runIds) {
            await client.query(
              `INSERT INTO app.chat_runs(org_id,chat_id,run_id,kind)
                 VALUES ($1,$2,$3,'answer')`,
              [ctx.orgId, chatId, runId],
            );
            await client.query(
              `UPDATE app.ai_runs SET status='completed',
                   final_output='cost answer',run_version=run_version+1,
                   updated_at=clock_timestamp(),completed_at=clock_timestamp()
                 WHERE org_id=$1 AND id=$2`,
              [ctx.orgId, runId],
            );
          }
          await client.query(
            `INSERT INTO app.chat_messages(
                 id,org_id,chat_id,parent_message_id,role,run_id)
               SELECT data.message_id,$1,$2,data.parent_id,'assistant',
                 data.run_id
               FROM unnest($3::uuid[],$4::uuid[],$5::uuid[])
                 AS data(message_id,parent_id,run_id)`,
            [ctx.orgId, chatId, assistantIds, userIds.slice(0, 50), runIds],
          );
          await client.query(
            `INSERT INTO app.ai_steps(
                 id,org_id,run_id,sequence,expected_version,state,fence,
                 committed_text)
               SELECT data.step,$1,data.run,1,1,'committed',1,'cost chunk'
               FROM unnest($2::uuid[],$3::uuid[]) AS data(step,run)`,
            [ctx.orgId, stepIds, runIds],
          );
          await client.query(
            `INSERT INTO app.ai_attempts(
                 id,org_id,run_id,step_id,ordinal,model_id,estimator_version,
                 estimated_input_tokens,reserved_input_tokens,
                 reserved_output_tokens,fence,active,outcome,settled_at)
               SELECT data.attempt,$1,data.run,data.step,1,
                 'synthetic/cost','cost-v1',1,1,4,1,false,'succeeded',
                 clock_timestamp()
               FROM unnest($2::uuid[],$3::uuid[],$4::uuid[])
                 AS data(attempt,run,step)`,
            [ctx.orgId, attemptIds, runIds, stepIds],
          );
          await client.query(
            `INSERT INTO app.ai_checkpoints(
                 org_id,run_id,step_id,attempt_id,fence,text)
               SELECT $1,data.run,data.step,data.attempt,1,'cost checkpoint'
               FROM unnest($2::uuid[],$3::uuid[],$4::uuid[])
                 AS data(run,step,attempt)`,
            [ctx.orgId, runIds, stepIds, attemptIds],
          );
          await client.query(
            `INSERT INTO app.message_feedback(
                 org_id,owner_user_id,chat_id,message_id,rating)
               SELECT $1,$2,$3,data.id,'good'
               FROM unnest($4::uuid[]) AS data(id)`,
            [ctx.orgId, ctx.userId, chatId, assistantIds.slice(0, 100)],
          );
        });

        const params = [ctx.orgId, ctx.userId, chatId];
        const inTenant = (sql: string, values: readonly unknown[]) =>
          fixture.database.withTenant(ctx, async (tx) => {
            const { client } = requireSession(tx);
            return client.query(sql, [...values]);
          });
        const readScope = buildAuthorizationPredicate({
          scope: 'chat-read',
          orgId: ctx.orgId,
          userId: ctx.userId,
          excludeDeleted: true,
        });
        const VALIDATOR = validatorSql(readScope);
        const TREE = treeSql(readScope);

        // One warm-up pass each, then the recorded pass.
        await explain(inTenant, VALIDATOR, params);
        await explain(inTenant, TREE, params);
        const validator = await explain(inTenant, VALIDATOR, params);
        const tree = await explain(inTenant, TREE, params);

        const validatorScans = seqScans(validator.Plan);
        const treeScans = seqScans(tree.Plan);
        const record = {
          recorded_at: new Date().toISOString(),
          corpus: {
            messages: 500,
            runs: 50,
            steps: 50,
            attempts: 50,
            checkpoints: 50,
            feedback: 100,
          },
          validator: {
            planning_ms: validator['Planning Time'] ?? null,
            execution_ms: validator['Execution Time'] ?? null,
            seq_scans_on_child_tables: validatorScans.filter((name) =>
              (CHILD_TABLES as readonly string[]).includes(name),
            ),
            plan: validator,
          },
          tree: {
            planning_ms: tree['Planning Time'] ?? null,
            execution_ms: tree['Execution Time'] ?? null,
            seq_scans_on_child_tables: treeScans.filter((name) =>
              (CHILD_TABLES as readonly string[]).includes(name),
            ),
            plan: tree,
          },
        };
        mkdirSync('test-results', { recursive: true });
        writeFileSync(
          'test-results/f44-etag-cost.json',
          JSON.stringify(record, null, 2) + '\n',
        );

        expect(
          record.validator.seq_scans_on_child_tables,
          'validator plan scans a child table sequentially',
        ).toEqual([]);

        // Stop rule (spec §5 item 15): the validator must be clearly
        // cheaper than the tree read; a failure here stops the change for
        // owner review rather than shipping a costly shortcut.
        expect(
          validator['Execution Time']!,
          `validator ${validator['Execution Time']}ms not cheaper ` +
            `than tree ${tree['Execution Time']}ms`,
        ).toBeLessThan(tree['Execution Time']! * 0.5);
      } finally {
        await Promise.all([app.close(), fixture.close()]);
      }
    });
  },
);
