import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { AiRunRepository } from '../ai-run.repository.js';
import { AiAttemptRepository } from '../ai-attempt.repository.js';
import { AiStepRepository } from '../ai-step.repository.js';
import { ChatRepository } from '../chat.repository.js';
import { ChatMessageRepository } from '../chat-message.repository.js';
import { requireSession } from '../tenant-session.js';
import type { ModelEvent, ModelGateway } from '../../ai/index.js';
import { createAiFixture } from './ai-fixture.js';
import type { StepClaim } from '../ai-records.js';

interface Services {
  readonly appUrl: string;
  readonly migratorUrl: string;
}

function modelBarrier(): {
  blockAfterText(): void;
  block(): Promise<void>;
  aborted: Promise<void>;
  release(): void;
  started: Promise<void>;
  gateway: ModelGateway;
} {
  let release!: () => void;
  let entered!: () => void;
  let shouldBlockAfterText = false;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  const started = new Promise<void>((resolve) => (entered = resolve));
  let resolveAbort!: () => void;
  const aborted = new Promise<void>((resolve) => (resolveAbort = resolve));
  async function* response(signal: AbortSignal): AsyncGenerator<ModelEvent> {
    entered();
    if (shouldBlockAfterText)
      yield { type: 'text', text: 'synthetic partial answer' };
    await Promise.race([
      blocked,
      new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolveAbort();
          resolve();
        } else
          signal.addEventListener(
            'abort',
            () => {
              resolveAbort();
              resolve();
            },
            { once: true },
          );
      }),
    ]);
    if (signal.aborted) {
      await blocked;
      throw signal.reason;
    }
    if (!shouldBlockAfterText)
      yield { type: 'text', text: 'synthetic answer after release' };
    yield {
      type: 'outcome',
      outcome: {
        finishReason: 'stop',
        attemptOutcome: 'succeeded',
        retryable: false,
        usage: { inputTokens: 1, outputTokens: 4 },
      },
    };
  }
  return {
    blockAfterText() {
      shouldBlockAfterText = true;
    },
    async block() {
      await started;
    },
    aborted,
    release,
    started,
    gateway: {
      generate(input) {
        return response(input.signal);
      },
    },
  };
}

export async function createChatFixture(services: Services) {
  const ai = await createAiFixture(services);
  const inspector = new Client({ connectionString: services.migratorUrl });
  await inspector.connect();
  const appClient = () => new Client({ connectionString: services.appUrl });
  const chats = new ChatRepository();
  const messages = new ChatMessageRepository();
  const runs = new AiRunRepository();
  const steps = new AiStepRepository();
  const attempts = new AiAttemptRepository();
  const mockModel = modelBarrier();
  function startDirectRunOutputWrite(
    tenant: { orgId: string; userId: string },
    runId: string,
  ) {
    let resolvePid!: (pid: number) => void;
    const pid = new Promise<number>((resolve) => (resolvePid = resolve));
    const done = ai.database.withTenant(tenant, async (tx) => {
      const { client } = requireSession(tx);
      const result = await client.query<{ pid: number }>(
        'SELECT pg_backend_pid() AS pid',
      );
      resolvePid(Number(result.rows[0]!.pid));
      await client.query(
        'UPDATE app.ai_runs SET partial_output=$3 WHERE org_id=$1 AND id=$2',
        [tenant.orgId, runId, 'must not persist'],
      );
    });
    return { pid, done };
  }
  async function holdStepClaimGuard(ctx: { orgId: string; userId: string }) {
    const acquired = deferred();
    const releaseSignal = deferred();
    const done = ai.database.withTenant(ctx, async (tx) => {
      const { client } = requireSession(tx);
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended('lexon.ai_step_claim:' || $1::text,0))`,
        [ctx.orgId],
      );
      acquired.resolve();
      await releaseSignal.promise;
    });
    await acquired.promise;
    return { release: releaseSignal.resolve, done };
  }

  const inspectChat = async (chatId: string) => {
    const result = await inspector.query(
      `SELECT id,org_id,owner_user_id,deleted_at,viewed_leaf_id,active_answer_run_id
       FROM app.chats WHERE id=$1`,
      [chatId],
    );
    return result.rows[0] ?? null;
  };
  async function selectWithoutTenant(chatId: string) {
    const client = appClient();
    await client.connect();
    try {
      return await client.query('SELECT id FROM app.chats WHERE id=$1', [
        chatId,
      ]);
    } finally {
      await client.end();
    }
  }
  async function markerWithoutTenant(
    orgId: string,
    userId: string,
    chatId: string,
  ) {
    const client = appClient();
    await client.connect();
    try {
      return await client.query<{ deleted: boolean }>(
        'SELECT ops.ai_mark_chat_deleted($1,$2,$3) AS deleted',
        [orgId, userId, chatId],
      );
    } finally {
      await client.end();
    }
  }
  async function directRunOutputAs(
    ctx: { orgId: string; userId: string },
    runId: string,
    output: string,
  ) {
    return ai.database.withTenant(ctx, async (tx) => {
      const { client } = requireSession(tx);
      return client.query(
        'UPDATE app.ai_runs SET partial_output=$3 WHERE org_id=$1 AND id=$2 RETURNING id',
        [ctx.orgId, runId, output],
      );
    });
  }
  async function directSetStepTextAs(
    ctx: { orgId: string; userId: string },
    runId: string,
    text: string,
  ) {
    return ai.database.withTenant(ctx, async (tx) => {
      const { client } = requireSession(tx);
      return client.query(
        'UPDATE app.ai_steps SET committed_text=$3 WHERE org_id=$1 AND run_id=$2',
        [ctx.orgId, runId, text],
      );
    });
  }
  async function setRunResourcesAs(
    ctx: { orgId: string; userId: string },
    runId: string,
    resourceIds: readonly string[],
  ) {
    return ai.database.withTenant(ctx, async (tx) => {
      const { client } = requireSession(tx);
      return client.query(
        `UPDATE app.ai_runs
         SET resolved_config=jsonb_set(resolved_config,'{resourceIds}',$3::jsonb)
         WHERE org_id=$1 AND id=$2 RETURNING id`,
        [ctx.orgId, runId, JSON.stringify(resourceIds)],
      );
    });
  }
  async function runWithoutTenant(runId: string) {
    const client = appClient();
    await client.connect();
    try {
      return await client.query(
        'SELECT partial_output,final_output FROM app.ai_runs WHERE id=$1',
        [runId],
      );
    } finally {
      await client.end();
    }
  }
  async function deletedCancellationFactsAs(
    ctx: { orgId: string; userId: string },
    input: {
      orgId: string;
      userId: string;
      runId: string;
      expectedVersion: number;
      sequence: number;
      stepId: string;
      fence: number;
    },
  ) {
    return ai.database.withTenant(ctx, async (tx) => {
      const { client } = requireSession(tx);
      return client.query(
        `SELECT * FROM ops.ai_chat_deleted_cancel_facts($1,$2,$3,$4,$5,$6,$7)`,
        [
          input.orgId,
          input.userId,
          input.runId,
          input.expectedVersion,
          input.sequence,
          input.stepId,
          input.fence,
        ],
      );
    });
  }
  async function deletedCancellationFactsWithoutTenant(input: {
    orgId: string;
    userId: string;
    runId: string;
    expectedVersion: number;
    sequence: number;
    stepId: string;
    fence: number;
  }) {
    const client = appClient();
    await client.connect();
    try {
      return await client.query(
        `SELECT * FROM ops.ai_chat_deleted_cancel_facts($1,$2,$3,$4,$5,$6,$7)`,
        [
          input.orgId,
          input.userId,
          input.runId,
          input.expectedVersion,
          input.sequence,
          input.stepId,
          input.fence,
        ],
      );
    } finally {
      await client.end();
    }
  }
  async function chatRunAssociatedAs(
    ctx: { orgId: string; userId: string },
    input: { orgId: string; userId: string; runId: string },
  ) {
    return ai.database.withTenant(ctx, async (tx) => {
      const { client } = requireSession(tx);
      return client.query<{ associated: boolean }>(
        'SELECT ops.ai_chat_run_is_associated($1,$2,$3) AS associated',
        [input.orgId, input.userId, input.runId],
      );
    });
  }
  async function chatRunAssociatedWithoutTenant(input: {
    orgId: string;
    userId: string;
    runId: string;
  }) {
    const client = appClient();
    await client.connect();
    try {
      return await client.query<{ associated: boolean }>(
        'SELECT ops.ai_chat_run_is_associated($1,$2,$3) AS associated',
        [input.orgId, input.userId, input.runId],
      );
    } finally {
      await client.end();
    }
  }
  async function directRelatedRunContent(
    ctx: { orgId: string; userId: string },
    runId: string,
  ) {
    return ai.database.withTenant(ctx, async (tx) => {
      const { client } = requireSession(tx);
      const [stepsResult, checkpointsResult, operationsResult] =
        await Promise.all([
          client.query(
            'SELECT committed_text FROM app.ai_steps WHERE org_id=$1 AND run_id=$2',
            [ctx.orgId, runId],
          ),
          client.query(
            'SELECT text FROM app.ai_checkpoints WHERE org_id=$1 AND run_id=$2',
            [ctx.orgId, runId],
          ),
          client.query(
            'SELECT args,result FROM app.ai_operations WHERE org_id=$1 AND run_id=$2',
            [ctx.orgId, runId],
          ),
        ]);
      return {
        steps: stepsResult.rows,
        checkpoints: checkpointsResult.rows,
        operations: operationsResult.rows,
      };
    });
  }
  async function deleteAssociationAs(
    ctx: { orgId: string; userId: string },
    runId: string,
  ) {
    return ai.database.withTenant(ctx, async (tx) => {
      const { client } = requireSession(tx);
      return client.query(
        'DELETE FROM app.chat_runs WHERE org_id=$1 AND run_id=$2 RETURNING run_id',
        [ctx.orgId, runId],
      );
    });
  }
  async function expireStepLeaseAs(
    ctx: { orgId: string; userId: string },
    runId: string,
  ) {
    return ai.database.withTenant(ctx, async (tx) => {
      const { client } = requireSession(tx);
      return client.query(
        `UPDATE app.ai_steps SET lease_until=clock_timestamp()-interval '1 second'
         WHERE org_id=$1 AND run_id=$2 AND state='claimed'`,
        [ctx.orgId, runId],
      );
    });
  }
  async function insertSyntheticAttemptFor(
    ctx: { orgId: string; userId: string },
    claim: StepClaim,
  ) {
    const attemptId = randomUUID();
    await ai.database.withTenant(ctx, (tx) =>
      attempts.insert(tx, claim, {
        attemptId,
        orgId: claim.orgId,
        runId: claim.runId,
        stepId: claim.stepId,
        ordinal: 1,
        modelId: 'synthetic/test',
        estimatorVersion: 'test-v1',
        estimatedInputTokens: 1,
        reservedInputTokens: 1,
        reservedOutputTokens: 4,
        generationId: null,
        provider: null,
        reportedInputTokens: null,
        reportedOutputTokens: null,
        cachedInputTokens: null,
        reasoningOutputTokens: null,
        costUsd: null,
        active: true,
        outcome: null,
        createdAt: new Date(),
        settledAt: null,
      }),
    );
    return attemptId;
  }

  return {
    database: ai.database,
    capacity: ai.capacity,
    capacityConfig: ai.capacityConfig,
    tenants: ai.tenants as readonly { orgId: string; userId: string }[],
    async expireCheckpointLeaseAfterInsert(runId: string) {
      const triggerToken = randomUUID().replaceAll('-', '');
      const triggerName = `task7_expire_${triggerToken}`;
      const functionName = `${triggerName}_fn`;
      if (!/^[0-9a-f-]{36}$/i.test(runId))
        throw new Error('Invalid test run id');
      await inspector.query(
        `CREATE FUNCTION app.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN
           IF NEW.run_id = '${runId}'::uuid THEN
             UPDATE app.ai_steps SET lease_until=clock_timestamp()-interval '1 second'
             WHERE id=NEW.step_id;
           END IF;
           RETURN NEW;
         END
         $$`,
      );
      await inspector.query(
        `CREATE TRIGGER ${triggerName} AFTER INSERT ON app.ai_checkpoints
         FOR EACH ROW EXECUTE FUNCTION app.${functionName}()`,
      );
      return async () => {
        await inspector.query(
          `DROP TRIGGER IF EXISTS ${triggerName} ON app.ai_checkpoints`,
        );
        await inspector.query(`DROP FUNCTION IF EXISTS app.${functionName}()`);
      };
    },
    chat: {
      create(index: number, chatId = randomUUID()) {
        return ai.withTenant(index, (tx) => chats.insert(tx, chatId));
      },
      createFor(ctx: { orgId: string; userId: string }, chatId = randomUUID()) {
        return ai.database.withTenant(ctx, (tx) => chats.insert(tx, chatId));
      },
      tree(index: number, chatId: string) {
        return ai.withTenant(index, (tx) => messages.tree(tx, chatId));
      },
      treeAs(ctx: { orgId: string; userId?: string }, chatId: string) {
        return ai.database.withTenant(ctx, (tx) => messages.tree(tx, chatId));
      },
      async linkAnswer(index: number, chatId: string, runId: string) {
        await ai.withTenant(index, async (tx) => {
          const { client } = requireSession(tx);
          await client.query(
            `UPDATE app.ai_runs SET resolved_config=jsonb_set(resolved_config,'{resourceIds}',$3::jsonb)
             WHERE org_id=$1 AND id=$2`,
            [ai.tenants[index]!.orgId, runId, JSON.stringify([chatId])],
          );
          await client.query(
            `INSERT INTO app.chat_runs(org_id,chat_id,run_id,kind)
             VALUES($1,$2,$3,'answer')`,
            [ai.tenants[index]!.orgId, chatId, runId],
          );
          await steps.insertInitial(tx, { id: randomUUID(), runId });
        });
      },
      async linkTitle(index: number, chatId: string, runId: string) {
        await ai.withTenant(index, async (tx) => {
          const { client } = requireSession(tx);
          await client.query(
            `UPDATE app.ai_runs SET resolved_config=jsonb_set(resolved_config,'{resourceIds}',$3::jsonb)
             WHERE org_id=$1 AND id=$2`,
            [ai.tenants[index]!.orgId, runId, JSON.stringify([chatId])],
          );
          await client.query(
            `INSERT INTO app.chat_runs(org_id,chat_id,run_id,kind)
             VALUES($1,$2,$3,'title')`,
            [ai.tenants[index]!.orgId, chatId, runId],
          );
          await steps.insertInitial(tx, { id: randomUUID(), runId });
        });
      },
      async associateStartedAnswer(
        index: number,
        chatId: string,
        runId: string,
      ) {
        await ai.withTenant(index, async (tx) => {
          if (!(await chats.lockLive(tx, chatId)))
            throw new Error('Chat fixture unavailable');
          const { client, ctx } = requireSession(tx);
          await client.query(
            `INSERT INTO app.chat_runs(org_id,chat_id,run_id,kind)
             VALUES($1,$2,$3,'answer')`,
            [ctx.orgId, chatId, runId],
          );
        });
      },
      async associateFor(
        ctx: { orgId: string; userId: string },
        chatId: string,
        runId: string,
      ) {
        await ai.database.withTenant(ctx, async (tx) => {
          if (!(await chats.lockLive(tx, chatId)))
            throw new Error('Chat fixture unavailable');
          const { client } = requireSession(tx);
          await client.query(
            `INSERT INTO app.chat_runs(org_id,chat_id,run_id,kind)
             VALUES($1,$2,$3,'answer')`,
            [ctx.orgId, chatId, runId],
          );
        });
      },
      setRunOutput(index: number, runId: string, text: string) {
        return ai.withTenant(index, async (tx) => {
          const { client } = requireSession(tx);
          await client.query(
            'UPDATE app.ai_runs SET partial_output=$3 WHERE org_id=$1 AND id=$2',
            [ai.tenants[index]!.orgId, runId, text],
          );
        });
      },
      setRunOutputFor(
        ctx: { orgId: string; userId: string },
        runId: string,
        text: string,
      ) {
        return ai.database.withTenant(ctx, async (tx) => {
          const { client } = requireSession(tx);
          const result = await client.query(
            'UPDATE app.ai_runs SET partial_output=$3 WHERE org_id=$1 AND id=$2',
            [ctx.orgId, runId, text],
          );
          if (result.rowCount !== 1) throw new Error('Run fixture unavailable');
        });
      },
      insertUser(
        index: number,
        input: Parameters<ChatMessageRepository['insertUser']>[1],
      ) {
        return ai.withTenant(index, (tx) => messages.insertUser(tx, input));
      },
      insertAssistant(
        index: number,
        input: Parameters<ChatMessageRepository['insertAssistant']>[1],
      ) {
        return ai.withTenant(index, (tx) =>
          messages.insertAssistant(tx, input),
        );
      },
      selectLeaf(index: number, chatId: string, leafId: string) {
        return ai.withTenant(index, (tx) =>
          chats.selectLeaf(tx, chatId, leafId),
        );
      },
      directHiddenUpdate(index: number, chatId: string) {
        return ai.withTenant(index, async (tx) => {
          const { client } = requireSession(tx);
          return client.query(
            `UPDATE app.chats SET deleted_at=clock_timestamp()
             WHERE org_id=$1 AND id=$2 AND owner_user_id=$3 AND deleted_at IS NULL
             RETURNING id`,
            [ai.tenants[index]!.orgId, chatId, ai.tenants[index]!.userId],
          );
        });
      },
      selectWithoutTenant,
      markerWithoutTenant,
      directRunOutputAs,
      directSetStepTextAs,
      setRunResourcesAs,
      async checkpointFor(
        ctx: { orgId: string; userId: string },
        claim: StepClaim,
        attemptId: string,
        text: string,
      ) {
        return ai.database.withTenant(ctx, (tx) =>
          steps.checkpoint(tx, claim, { attemptId, text }),
        );
      },
      insertSyntheticAttemptFor,
      async deactivateAttemptFor(
        ctx: { orgId: string; userId: string },
        attemptId: string,
      ) {
        return ai.database.withTenant(ctx, async (tx) => {
          const { client } = requireSession(tx);
          return client.query(
            `UPDATE app.ai_attempts SET active=false,outcome='failed',settled_at=clock_timestamp()
             WHERE org_id=$1 AND id=$2`,
            [ctx.orgId, attemptId],
          );
        });
      },
      runWithoutTenant,
      deletedCancellationFactsAs,
      deletedCancellationFactsWithoutTenant,
      chatRunAssociatedAs,
      chatRunAssociatedWithoutTenant,
      directRelatedRunContent,
      deleteAssociationAs,
      expireStepLeaseAs,
      delete(index: number, chatId: string) {
        return ai.withTenant(index, (tx) => chats.markDeleted(tx, chatId));
      },
      deleteFor(ctx: { orgId: string; userId: string }, chatId: string) {
        return ai.database.withTenant(ctx, (tx) =>
          chats.markDeleted(tx, chatId),
        );
      },
      claim(index: number, runId: string) {
        return ai.withTenant(index, (tx) =>
          steps.claim(tx, {
            runId,
            sequence: 1,
            expectedVersion: 1,
            leaseMs: 30_000,
          }),
        );
      },
      async insertAttempt(
        index: number,
        claim: NonNullable<Awaited<ReturnType<typeof steps.claim>>>['claim'],
      ) {
        const attemptId = randomUUID();
        await ai.withTenant(index, async (tx) => {
          await attempts.insert(tx, claim, {
            attemptId,
            orgId: claim.orgId,
            runId: claim.runId,
            stepId: claim.stepId,
            ordinal: 1,
            modelId: 'synthetic/test',
            estimatorVersion: 'test-v1',
            estimatedInputTokens: 1,
            reservedInputTokens: 1,
            reservedOutputTokens: 4,
            generationId: null,
            provider: null,
            reportedInputTokens: null,
            reportedOutputTokens: null,
            cachedInputTokens: null,
            reasoningOutputTokens: null,
            costUsd: null,
            active: true,
            outcome: null,
            createdAt: new Date(),
            settledAt: null,
          });
        });
        return attemptId;
      },
      checkpoint(
        index: number,
        claim: NonNullable<Awaited<ReturnType<typeof steps.claim>>>['claim'],
        attemptId: string,
      ) {
        return ai.withTenant(index, (tx) =>
          steps.checkpoint(tx, claim, {
            attemptId,
            text: 'checkpoint content',
          }),
        );
      },
      transitionOutput(index: number, runId: string) {
        return ai.withTenant(index, (tx) =>
          runs.transition(tx, {
            runId,
            expectedVersion: 1,
            from: 'queued',
            to: 'failed',
            outputAppend: 'late content',
          }),
        );
      },
      transitionStatus(index: number, runId: string) {
        return ai.withTenant(index, (tx) =>
          runs.transition(tx, {
            runId,
            expectedVersion: 1,
            from: 'queued',
            to: 'cancelled',
          }),
        );
      },
      directCheckpointWrite(index: number, checkpointId: string) {
        return ai.withTenant(index, async (tx) => {
          const { client } = requireSession(tx);
          return client.query(
            'UPDATE app.ai_checkpoints SET text=$3 WHERE org_id=$1 AND id=$2',
            [ai.tenants[index]!.orgId, checkpointId, 'direct late checkpoint'],
          );
        });
      },
      directReasoningWrites(index: number, runId: string) {
        return ai.withTenant(index, async (tx) => {
          const { client } = requireSession(tx);
          const run = await client.query(
            'UPDATE app.ai_runs SET reasoning_summary=$3,reasoning_duration_ms=$4 WHERE org_id=$1 AND id=$2 RETURNING id',
            [ai.tenants[index]!.orgId, runId, 'must stay fenced', 3000],
          );
          const checkpoint = await client.query(
            'UPDATE app.ai_checkpoints SET reasoning_summary=$3,reasoning_duration_ms=$4 WHERE org_id=$1 AND run_id=$2 RETURNING run_id',
            [ai.tenants[index]!.orgId, runId, 'must stay fenced', 3000],
          );
          return { run: run.rowCount, checkpoint: checkpoint.rowCount };
        });
      },
    },
    inspect: {
      async installUnexpectedOutboxUniqueViolation() {
        await inspector.query(
          `CREATE FUNCTION ops.task9_unexpected_outbox_unique() RETURNS trigger
           LANGUAGE plpgsql AS $$ BEGIN
             IF NEW.type='run.start.v1' THEN
               RAISE unique_violation USING CONSTRAINT='task9_unexpected_outbox_unique';
             END IF;
             RETURN NEW;
           END $$;
           CREATE TRIGGER task9_unexpected_outbox_unique
           BEFORE INSERT ON ops.outbox FOR EACH ROW
           EXECUTE FUNCTION ops.task9_unexpected_outbox_unique()`,
        );
        return async () => {
          await inspector.query(
            'DROP TRIGGER IF EXISTS task9_unexpected_outbox_unique ON ops.outbox',
          );
          await inspector.query(
            'DROP FUNCTION IF EXISTS ops.task9_unexpected_outbox_unique()',
          );
        };
      },
      async mutationRequestRuntimeDenials(ctx: {
        orgId: string;
        userId: string;
      }) {
        return ai.database.withTenant(ctx, async (tx) => {
          const { client } = requireSession(tx);
          const errors: string[] = [];
          const attempts = [
            'UPDATE app.chat_mutation_requests SET created_at=created_at',
            'DELETE FROM app.chat_mutation_requests',
            'TRUNCATE app.chat_mutation_requests',
          ];
          for (let attempt = 0; attempt < attempts.length; attempt += 1) {
            await client.query(`SAVEPOINT mutation_privilege_${attempt}`);
            try {
              await client.query(attempts[attempt]!);
              errors.push('allowed');
            } catch (error) {
              errors.push(
                typeof error === 'object' && error !== null && 'code' in error
                  ? String(error.code)
                  : 'unknown',
              );
            }
            await client.query(
              `ROLLBACK TO SAVEPOINT mutation_privilege_${attempt}`,
            );
            await client.query(
              `RELEASE SAVEPOINT mutation_privilege_${attempt}`,
            );
          }
          return errors;
        });
      },
      async mutationRequestPrivileges() {
        const result = await inspector.query<{
          rls_enabled: boolean;
          rls_forced: boolean;
          can_select: boolean;
          can_insert: boolean;
          can_update: boolean;
          can_delete: boolean;
          can_truncate: boolean;
        }>(
          `SELECT relation.relrowsecurity AS rls_enabled,
            relation.relforcerowsecurity AS rls_forced,
            has_table_privilege('lexon_app','app.chat_mutation_requests','SELECT') AS can_select,
            has_table_privilege('lexon_app','app.chat_mutation_requests','INSERT') AS can_insert,
            has_table_privilege('lexon_app','app.chat_mutation_requests','UPDATE') AS can_update,
            has_table_privilege('lexon_app','app.chat_mutation_requests','DELETE') AS can_delete,
            has_table_privilege('lexon_app','app.chat_mutation_requests','TRUNCATE') AS can_truncate
           FROM pg_class relation JOIN pg_namespace schema_name ON schema_name.oid=relation.relnamespace
           WHERE schema_name.nspname='app' AND relation.relname='chat_mutation_requests'`,
        );
        return result.rows[0]!;
      },
      chat: inspectChat,
      async runStatus(runId: string) {
        const result = await inspector.query<{ status: string }>(
          'SELECT status FROM app.ai_runs WHERE id=$1',
          [runId],
        );
        return result.rows[0]?.status ?? null;
      },
      async chatSchema() {
        const result = await inspector.query(
          `SELECT c.relrowsecurity,c.relforcerowsecurity,
                  jsonb_agg(a.attname ORDER BY a.attname) AS columns
           FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
           JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
           WHERE n.nspname='app' AND c.relname='chats'
           GROUP BY c.oid,c.relrowsecurity,c.relforcerowsecurity`,
        );
        return result.rows;
      },
      async messageColumns() {
        const result = await inspector.query<{ column_name: string }>(
          `SELECT column_name FROM information_schema.columns
           WHERE table_schema='app' AND table_name='chat_messages' ORDER BY column_name`,
        );
        return result.rows.map((row) => row.column_name);
      },
      async markerGrants() {
        const result = await inspector.query(
          `SELECT has_function_privilege('lexon_app','ops.ai_mark_chat_deleted(uuid,uuid,uuid)','EXECUTE') AS app_can_execute,
                  has_function_privilege('lexon_auth','ops.ai_mark_chat_deleted(uuid,uuid,uuid)','EXECUTE') AS auth_can_execute,
                  has_function_privilege('public','ops.ai_mark_chat_deleted(uuid,uuid,uuid)','EXECUTE') AS public_can_execute`,
        );
        return result.rows[0];
      },
      async lifecycleFunctionPrivileges() {
        const result = await inspector.query(
          `SELECT has_function_privilege('lexon_app','ops.ai_chat_deleted_cancel_facts(uuid,uuid,uuid,integer,integer,uuid,bigint)','EXECUTE') AS app_can_execute,
                  has_function_privilege('lexon_auth','ops.ai_chat_deleted_cancel_facts(uuid,uuid,uuid,integer,integer,uuid,bigint)','EXECUTE') AS auth_can_execute,
                  has_function_privilege('public','ops.ai_chat_deleted_cancel_facts(uuid,uuid,uuid,integer,integer,uuid,bigint)','EXECUTE') AS public_can_execute,
                  has_function_privilege('lexon_app','ops.ai_chat_finalize_deleted_cancel(uuid,uuid,uuid,integer,integer,uuid,bigint)','EXECUTE') AS app_can_finalize,
                  has_function_privilege('lexon_auth','ops.ai_chat_finalize_deleted_cancel(uuid,uuid,uuid,integer,integer,uuid,bigint)','EXECUTE') AS auth_can_finalize,
                  has_function_privilege('public','ops.ai_chat_finalize_deleted_cancel(uuid,uuid,uuid,integer,integer,uuid,bigint)','EXECUTE') AS public_can_finalize`,
        );
        return result.rows[0];
      },
      async chatAssociationFunctionPrivileges() {
        const result = await inspector.query(
          `SELECT has_function_privilege('lexon_app','ops.ai_chat_run_is_associated(uuid,uuid,uuid)','EXECUTE') AS app_can_execute,
                  has_function_privilege('lexon_auth','ops.ai_chat_run_is_associated(uuid,uuid,uuid)','EXECUTE') AS auth_can_execute,
                  has_function_privilege('public','ops.ai_chat_run_is_associated(uuid,uuid,uuid)','EXECUTE') AS public_can_execute`,
        );
        return result.rows[0];
      },
      async effectiveChatTablePrivileges() {
        const result = await inspector.query(
          `SELECT table_name,
            has_table_privilege('lexon_app',format('app.%I',table_name),'DELETE') AS can_delete,
            has_table_privilege('lexon_app',format('app.%I',table_name),'TRUNCATE') AS can_truncate
           FROM (VALUES ('chats'),('chat_runs'),('chat_messages')) AS names(table_name)
           ORDER BY table_name`,
        );
        return result.rows;
      },
      async tree(chatId: string) {
        const result = await inspector.query(
          `SELECT m.id,m.parent_message_id,m.role,m.user_text,m.run_id,r.partial_output,r.final_output
           FROM app.chat_messages m LEFT JOIN app.ai_runs r ON r.org_id=m.org_id AND r.id=m.run_id
           WHERE m.chat_id=$1 ORDER BY m.created_at,m.id`,
          [chatId],
        );
        return result.rows;
      },
      async runs(runId: string) {
        const result = await inspector.query(
          'SELECT id,status,partial_output,final_output FROM app.ai_runs WHERE id=$1',
          [runId],
        );
        return result.rows[0] ?? null;
      },
      async streamMetadata(runId: string) {
        const result = await inspector.query(
          'SELECT stream_generation::integer AS stream_generation,stream_snapshot_generation::integer AS stream_snapshot_generation,stream_event_id,stream_resumable FROM app.ai_runs WHERE id=$1',
          [runId],
        );
        return result.rows[0] ?? null;
      },
      async checkpoints(index: number, runId: string) {
        return ai.withTenant(index, async (tx) => {
          const { client } = requireSession(tx);
          const result = await client.query(
            'SELECT id,text FROM app.ai_checkpoints WHERE run_id=$1 ORDER BY created_at,id',
            [runId],
          );
          return result.rows;
        });
      },
      async reasoningCheckpoints(index: number, runId: string) {
        return ai.withTenant(index, async (tx) => {
          const { client } = requireSession(tx);
          const result = await client.query(
            'SELECT text,reasoning_summary,reasoning_duration_ms,stream_generation::integer AS stream_generation,stream_event_id,stream_revision,stream_resumable FROM app.ai_checkpoints WHERE run_id=$1 ORDER BY created_at,id',
            [runId],
          );
          return result.rows;
        });
      },
      async outbox(chatId: string) {
        const result = await inspector.query(
          `SELECT id,type,payload FROM ops.outbox WHERE type='chat.cleanup.v1' AND payload->>'chatId'=$1`,
          [chatId],
        );
        return result.rows;
      },
      async mutationCounts(input: { chatId: string; runId: string }) {
        const result = await inspector.query<{
          messages: string;
          answers: string;
          create_requests: string;
          runs: string;
          start_outbox: string;
          start_audit: string;
          chat_audit: string;
          slots: string;
        }>(
          `SELECT
            (SELECT count(*) FROM app.chat_messages WHERE chat_id=$1) AS messages,
            (SELECT count(*) FROM app.chat_runs WHERE chat_id=$1 AND kind='answer') AS answers,
            (SELECT count(*) FROM app.chat_create_requests WHERE chat_id=$1) AS create_requests,
            (SELECT count(*) FROM app.ai_runs WHERE id=$2) AS runs,
            (SELECT count(*) FROM ops.outbox WHERE type='run.start.v1' AND payload->>'runId'=$2::text) AS start_outbox,
            (SELECT count(*) FROM ops.audit_events WHERE type='chat.run_started.v1' AND metadata->>'runId'=$2::text) AS start_audit,
            (SELECT count(*) FROM ops.audit_events WHERE type IN ('chat.created.v1','chat.message_sent.v1') AND metadata->>'chatId'=$1::text) AS chat_audit,
            (SELECT count(*) FROM ops.ai_run_slots WHERE run_id=$2) AS slots`,
          [input.chatId, input.runId],
        );
        return result.rows[0]!;
      },
      async chatSendSnapshot(chatId: string) {
        const result = await inspector.query<{
          messages: string;
          answers: string;
          runs: string;
          start_outbox: string;
          start_audit: string;
          message_audit: string;
          slots: string;
        }>(
          `WITH chat_runs AS (
             SELECT run_id FROM app.chat_runs WHERE chat_id=$1 AND kind='answer'
           )
           SELECT
             (SELECT count(*) FROM app.chat_messages WHERE chat_id=$1) AS messages,
             (SELECT count(*) FROM app.chat_runs WHERE chat_id=$1 AND kind='answer') AS answers,
             (SELECT count(*) FROM app.ai_runs WHERE id IN (SELECT run_id FROM chat_runs)) AS runs,
             (SELECT count(*) FROM ops.outbox WHERE type='run.start.v1' AND payload->>'runId' IN (SELECT run_id::text FROM chat_runs)) AS start_outbox,
             (SELECT count(*) FROM ops.audit_events WHERE type='chat.run_started.v1' AND metadata->>'runId' IN (SELECT run_id::text FROM chat_runs)) AS start_audit,
             (SELECT count(*) FROM ops.audit_events WHERE type='chat.message_sent.v1' AND metadata->>'chatId'=$1::text) AS message_audit,
             (SELECT count(*) FROM ops.ai_run_slots WHERE run_id IN (SELECT run_id FROM chat_runs)) AS slots`,
          [chatId],
        );
        return result.rows[0]!;
      },
      async rollbackCounts(input: { chatId: string; prompt: string }) {
        const result = await inspector.query<{
          chats: string;
          messages: string;
          runs: string;
          outbox: string;
          audit: string;
          chat_audit: string;
          slots: string;
        }>(
          `WITH run_ids AS (SELECT id FROM app.ai_runs WHERE input_text=$2)
           SELECT
             (SELECT count(*) FROM app.chats WHERE id=$1) AS chats,
             (SELECT count(*) FROM app.chat_messages WHERE chat_id=$1) AS messages,
             (SELECT count(*) FROM run_ids) AS runs,
             (SELECT count(*) FROM ops.outbox WHERE payload->>'runId' IN (SELECT id::text FROM run_ids)) AS outbox,
             (SELECT count(*) FROM ops.audit_events WHERE metadata->>'runId' IN (SELECT id::text FROM run_ids)) AS audit,
             (SELECT count(*) FROM ops.audit_events WHERE metadata->>'chatId'=$1::text AND type IN ('chat.created.v1','chat.message_sent.v1')) AS chat_audit,
             (SELECT count(*) FROM ops.ai_run_slots WHERE run_id IN (SELECT id FROM run_ids)) AS slots`,
          [input.chatId, input.prompt],
        );
        return result.rows[0]!;
      },
      async chatAudit(chatId: string) {
        const result = await inspector.query<{
          type: string;
          metadata: unknown;
        }>(
          `SELECT type,metadata FROM ops.audit_events
           WHERE type IN ('chat.created.v1','chat.message_sent.v1')
             AND metadata->>'chatId'=$1::text ORDER BY type`,
          [chatId],
        );
        return result.rows;
      },
      async insertRawAudit(input: {
        eventId: string;
        actorUserId: string;
        orgId: string;
        metadata: Readonly<Record<string, unknown>>;
      }) {
        return inspector.query(
          `INSERT INTO ops.audit_events
           (event_id,version,type,occurred_at,outcome,actor_user_id,org_id,metadata)
           VALUES($1,1,'chat.created.v1',clock_timestamp(),'success',$2,$3,$4::jsonb)`,
          [
            input.eventId,
            input.actorUserId,
            input.orgId,
            JSON.stringify(input.metadata),
          ],
        );
      },
      async failChatCreateRequestInsert() {
        const triggerName = `fail_chat_create_${randomUUID().replaceAll('-', '')}`;
        await inspector.query(
          `CREATE FUNCTION public.${triggerName}() RETURNS trigger
           LANGUAGE plpgsql AS $$ BEGIN
             RAISE EXCEPTION 'injected transaction failure' USING ERRCODE='23514';
           END $$`,
        );
        await inspector.query(
          `CREATE TRIGGER ${triggerName} BEFORE INSERT ON app.chat_create_requests
           FOR EACH ROW EXECUTE FUNCTION public.${triggerName}()`,
        );
        return async () => {
          await inspector.query(
            `DROP TRIGGER IF EXISTS ${triggerName} ON app.chat_create_requests`,
          );
          await inspector.query(
            `DROP FUNCTION IF EXISTS public.${triggerName}()`,
          );
        };
      },
      async usage(runId: string) {
        const result = await inspector.query(
          'SELECT * FROM app.usage_events WHERE run_id=$1',
          [runId],
        );
        return result.rows;
      },
      async usageFor(ctx: { orgId: string; userId: string }, runId: string) {
        return ai.database.withTenant(ctx, async (tx) => {
          const { client } = requireSession(tx);
          const result = await client.query(
            'SELECT * FROM app.usage_events WHERE org_id=$1 AND actor_user_id=$2 AND run_id=$3',
            [ctx.orgId, ctx.userId, runId],
          );
          return result.rows;
        });
      },
      async capacity(runId: string) {
        const result = await inspector.query(
          'SELECT * FROM ops.ai_run_slots WHERE run_id=$1',
          [runId],
        );
        return result.rows;
      },
    },
    model: mockModel,
    startDirectRunOutputWrite,
    holdStepClaimGuard,
    waitForClaimLockWaiters: async (expected: number) => {
      for (let attempt = 0; attempt < 500; attempt++) {
        const result = await inspector.query<{ count: number }>(
          `SELECT count(*)::int AS count
           FROM pg_stat_activity a
           JOIN pg_locks l ON l.pid=a.pid
           WHERE a.usename='lexon_app' AND a.datname=current_database()
             AND l.locktype='advisory' AND NOT l.granted`,
        );
        if (result.rows[0]!.count >= expected) return true;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return false;
    },
    waitForLockWait: async (pid: number) => {
      for (let attempt = 0; attempt < 300; attempt++) {
        const result = await inspector.query<{ waiting: boolean }>(
          'SELECT EXISTS(SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted) AS waiting',
          [pid],
        );
        if (result.rows[0]?.waiting) return true;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return false;
    },
    async close() {
      await Promise.all([inspector.end(), ai.close()]);
    },
  };
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}
