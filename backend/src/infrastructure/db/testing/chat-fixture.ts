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

interface Services {
  readonly appUrl: string;
  readonly migratorUrl: string;
}

function modelBarrier(): {
  block(): Promise<void>;
  release(): void;
  started: Promise<void>;
  gateway: ModelGateway;
} {
  let release!: () => void;
  let entered!: () => void;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  const started = new Promise<void>((resolve) => (entered = resolve));
  async function* response(): AsyncGenerator<ModelEvent> {
    entered();
    await blocked;
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
    async block() {
      await started;
    },
    release,
    started,
    gateway: {
      generate() {
        return response();
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

  return {
    database: ai.database,
    capacity: ai.capacity,
    capacityConfig: ai.capacityConfig,
    tenants: ai.tenants as readonly { orgId: string; userId: string }[],
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
    },
    inspect: {
      chat: inspectChat,
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
      async outbox(chatId: string) {
        const result = await inspector.query(
          `SELECT id,type,payload FROM ops.outbox WHERE type='chat.cleanup.v1' AND payload->>'chatId'=$1`,
          [chatId],
        );
        return result.rows;
      },
      async usage(runId: string) {
        const result = await inspector.query(
          'SELECT * FROM app.usage_events WHERE run_id=$1',
          [runId],
        );
        return result.rows;
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
