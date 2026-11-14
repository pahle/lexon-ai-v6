import { createServer } from 'node:net';
import { chmod, rm } from 'node:fs/promises';
import Redis from 'ioredis';
import { Client } from 'pg';
import { NestFactory } from '@nestjs/core';
import { loadRuntimeConfig } from '../../dist/config/runtime-config.js';
import { AiWorkerRootModule } from '../../dist/entrypoints/ai-worker/root.module.js';
import { MODEL_GATEWAY } from '../../dist/infrastructure/ai/ai.module.js';

const socketPath = '/run/lexon/health/chat-proof.sock';
const config = loadRuntimeConfig('ai-worker', process.env);
const streamInspector = new Redis(config.valkey.streamsUrl, {
  lazyConnect: true,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 0,
  autoResendUnfulfilledCommands: false,
  retryStrategy: () => null,
  connectTimeout: 500,
  commandTimeout: 500,
});
streamInspector.on('error', () => undefined);
await streamInspector.connect();
const runs = new Map();
const retryCounts = new Map();
const inputShapes = new Map();
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function readTenantChatTree(chatId, tenant) {
  if (
    !tenant ||
    !uuidPattern.test(tenant.orgId) ||
    !uuidPattern.test(tenant.userId) ||
    !Array.isArray(tenant.expected) ||
    tenant.expected.length > 128 ||
    tenant.expected.some(
      (message) =>
        !message ||
        !uuidPattern.test(message.id) ||
        !['user', 'assistant'].includes(message.role) ||
        typeof message.text !== 'string' ||
        message.text.length > 16_384,
    )
  )
    throw new Error('invalid tenant tree read');
  const database = new Client({ connectionString: config.database.appUrl });
  await database.connect();
  try {
    await database.query('BEGIN');
    await database.query(
      "SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)",
      [tenant.orgId, tenant.userId],
    );
    const result = await database.query(
      `SELECT chat.viewed_leaf_id AS "viewedLeafId",
        COALESCE(jsonb_agg(jsonb_build_object(
          'id', message.id,
          'parentId', message.parent_message_id,
          'role', message.role,
          'status', run.status,
          'textMatches', CASE
            WHEN message.role='user'
              THEN message.user_text IS NOT DISTINCT FROM expected.expected_text
            WHEN message.role='assistant'
              THEN run.final_output IS NOT DISTINCT FROM expected.expected_text
            ELSE false
          END
        ) ORDER BY message.created_at,message.id)
          FILTER (WHERE message.id IS NOT NULL), '[]'::jsonb) AS messages
       FROM app.chats chat
       LEFT JOIN app.chat_messages message
         ON message.org_id=chat.org_id AND message.chat_id=chat.id
       LEFT JOIN app.ai_runs run
         ON run.org_id=message.org_id AND run.id=message.run_id
       LEFT JOIN jsonb_to_recordset($4::jsonb)
         AS expected(id uuid, role text, expected_text text)
         ON expected.id=message.id AND expected.role=message.role
       WHERE chat.org_id=$1 AND chat.owner_user_id=$2 AND chat.id=$3
         AND chat.deleted_at IS NULL
       GROUP BY chat.viewed_leaf_id`,
      [
        tenant.orgId,
        tenant.userId,
        chatId,
        JSON.stringify(
          tenant.expected.map(({ id, role, text }) => ({
            id,
            role,
            expected_text: text,
          })),
        ),
      ],
    );
    await database.query('ROLLBACK');
    return result.rows[0] ?? null;
  } finally {
    await database.end();
  }
}

function contentShape(content) {
  if (Array.isArray(content))
    return {
      type: 'array',
      partTypes: content.map((part) =>
        part &&
        typeof part === 'object' &&
        'type' in part &&
        typeof part.type === 'string'
          ? part.type
          : typeof part,
      ),
      textLengths: content.flatMap((part) =>
        part &&
        typeof part === 'object' &&
        'text' in part &&
        typeof part.text === 'string'
          ? [part.text.length]
          : [],
      ),
    };
  if (content && typeof content === 'object')
    return { type: 'object', keys: Object.keys(content).slice(0, 16) };
  return {
    type: typeof content,
    ...(typeof content === 'string' ? { textLength: content.length } : {}),
  };
}

function latestPrompt(input) {
  const message = [...input.messages]
    .reverse()
    .find((entry) => entry.role === 'user');
  return typeof message?.content === 'string' ? message.content : '';
}

function createScriptedGateway() {
  return {
    async *generate(input) {
      const runId = input.runId;
      const attemptId = input.attemptId;
      if (!runId || !attemptId)
        throw new Error('Scripted worker requires run identities');
      const messages = Array.isArray(input.messages) ? input.messages : [];
      const lastUser = [...messages]
        .reverse()
        .find((entry) => entry?.role === 'user');
      inputShapes.set(runId, {
        stepId: input.stepId,
        attemptId: input.attemptId,
        messageCount: messages.length,
        roles: messages
          .map((entry) => entry?.role)
          .filter((role) => typeof role === 'string'),
        lastUser: lastUser ? contentShape(lastUser.content) : null,
      });
      const prompt = latestPrompt(input);
      const count = (retryCounts.get(prompt) ?? 0) + 1;
      retryCounts.set(prompt, count);
      const held = prompt.includes('[runtime-proof:hold]');
      let releasePrefix;
      let releaseSuffix;
      let releaseAnswer;
      let releaseSecondAnswer;
      const prefixGate = new Promise((resolve) => {
        releasePrefix = resolve;
      });
      const suffixGate = new Promise((resolve) => {
        releaseSuffix = resolve;
      });
      const answerGate = new Promise((resolve) => {
        releaseAnswer = resolve;
      });
      const secondAnswerGate = new Promise((resolve) => {
        releaseSecondAnswer = resolve;
      });
      runs.set(runId, {
        blocked: false,
        prefixBlocked: held,
        answerBlocked: false,
        secondAnswerBlocked: false,
        released: false,
        releasePrefix,
        releaseSuffix,
        releaseAnswer,
        releaseSecondAnswer,
      });

      yield {
        type: 'metadata',
        generationId: `e2e-${runId}`,
        provider: 'lexon-e2e-scripted',
      };
      if (prompt.includes('[task14:preview]')) {
        yield { type: 'reasoning-start', attemptId };
        yield {
          type: 'reasoning-summary-delta',
          attemptId,
          text: 'The clause shifts open-ended responsibility to the supplier.\n\n- Cap direct damages.\n- Exclude indirect loss.\n\n![remote summary image](https://remote.invalid/summary.png)',
        };
        yield { type: 'reasoning-end', attemptId, durationMs: 2_300 };
        await new Promise((resolve) => setTimeout(resolve, 450));
      } else if (prompt.includes('[runtime-proof:reasoning]')) {
        yield { type: 'reasoning-start', attemptId };
        yield {
          type: 'reasoning-summary-delta',
          attemptId,
          text: 'Synthetic reasoning summary.',
        };
        yield { type: 'reasoning-end', attemptId, durationMs: 17 };
      } else if (prompt.includes('[task14:raw-duration]')) {
        yield { type: 'reasoning-start', attemptId };
        yield { type: 'reasoning-end', attemptId, durationMs: 2_300 };
      }
      if (held && prompt.includes('[task14:preview]')) {
        await prefixGate;
        const run = runs.get(runId);
        if (run) {
          run.prefixBlocked = false;
          run.blocked = false;
        }
      }
      if (held && !prompt.includes('[task14:preview]')) {
        await prefixGate;
        const run = runs.get(runId);
        if (run) run.prefixBlocked = false;
        yield { type: 'text', text: 'Answer prefix — ' };
        if (run) run.blocked = true;
        await Promise.race([
          suffixGate,
          new Promise((_, reject) =>
            input.signal.addEventListener(
              'abort',
              () => reject(new Error('aborted')),
              { once: true },
            ),
          ),
        ]);
        if (run) run.blocked = false;
        yield { type: 'text', text: 'answer suffix.' };
      } else if (prompt.includes('[runtime-proof:error]') && count === 1) {
        yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } };
        yield {
          type: 'outcome',
          outcome: {
            finishReason: 'error',
            attemptOutcome: 'failed',
            retryable: false,
            safeCode: 'AI_PROVIDER_UNAVAILABLE',
            generationId: `e2e-${runId}`,
            provider: 'lexon-e2e-scripted',
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        };
        return;
      } else {
        const answer = prompt.includes('[task14:preview]')
          ? '## Liability review\n\nThe supplier accepts **uncapped direct liability** in section 8.\n\n- Add a fee-based cap.\n- Exclude consequential and indirect damages.\n- Keep the carve-outs narrow and explicit.\n\n![remote answer image](https://remote.invalid/answer.png)\n\nSee the [contract text](https://example.test/contract).'
          : prompt.includes('[task14:byte-boundary]')
            ? 'Accepted exact 16,384-byte prompt.'
            : prompt.includes('[runtime-proof:reasoning]')
              ? 'Reasoned synthetic answer.'
              : prompt.includes('[runtime-proof:error]')
                ? 'Try again succeeded.'
                : prompt.includes('[runtime-proof:edit]')
                  ? 'Edited answer.'
                  : prompt.includes('[runtime-proof:regenerate]')
                    ? `Sibling answer ${count}.`
                    : `Scripted answer: ${prompt.replace(/\[runtime-proof:[^\]]+\]/g, '').trim()}`;
        const parts = [...answer].map((text) => ({ type: 'text', text }));
        if (prompt.includes('[task14:preview]')) {
          for (let index = 0; index < answer.length; index += 24) {
            yield { type: 'text', text: answer.slice(index, index + 24) };
            if (held && index === 0) {
              const run = runs.get(runId);
              if (run) run.answerBlocked = true;
              await answerGate;
              if (run) run.answerBlocked = false;
            }
            if (held && index === 24) {
              const run = runs.get(runId);
              if (run) run.secondAnswerBlocked = true;
              await secondAnswerGate;
              if (run) run.secondAnswerBlocked = false;
            }
            await new Promise((resolve) => setTimeout(resolve, 16));
          }
        } else {
          for (const part of parts) yield part;
        }
      }

      yield { type: 'usage', usage: { inputTokens: 4, outputTokens: 4 } };
      yield {
        type: 'outcome',
        outcome: {
          finishReason: 'stop',
          attemptOutcome: 'succeeded',
          retryable: false,
          generationId: `e2e-${runId}`,
          provider: 'lexon-e2e-scripted',
          usage: { inputTokens: 4, outputTokens: 4 },
        },
      };
      runs.delete(runId);
    },
  };
}

await rm(socketPath, { force: true });
const control = createServer((socket) => {
  socket.setEncoding('utf8');
  socket.setTimeout(5000, () => socket.destroy());
  let buffer = '';
  socket.on('data', async (chunk) => {
    buffer += chunk;
    if (buffer.length > 16_384) return socket.destroy();
    if (!buffer.includes('\n')) return;
    try {
      const { op, runId, cursor } = JSON.parse(buffer.split('\n')[0]);
      if (
        ![
          'status',
          'release-prefix',
          'release-answer',
          'release-second-answer',
          'release',
          'cursor',
          'trim',
          'shape',
          'database-tree',
          'expire',
        ].includes(op) ||
        typeof runId !== 'string' ||
        !uuidPattern.test(runId)
      )
        throw new Error('invalid control command');
      if (op === 'database-tree') {
        const tenant = JSON.parse(cursor);
        const result = await readTenantChatTree(runId, tenant);
        socket.end(JSON.stringify(result) + '\n');
        return;
      }
      if (op === 'expire') {
        const keys = ['events', 'guard', 'generation'].map(
          (suffix) => `${config.queuePrefix}:{run-streams}:${runId}:${suffix}`,
        );
        const before = await streamInspector.exists(...keys);
        const armedResults = await Promise.all(
          keys.map((key) => streamInspector.pexpire(key, 500)),
        );
        const armed = armedResults.reduce((count, result) => count + result, 0);
        const ttls = await Promise.all(
          keys.map((key) => streamInspector.pttl(key)),
        );
        const hadPositiveTtl = before === 3 && ttls.every((ttl) => ttl > 0);
        const deadline = Date.now() + 1_500;
        let remaining = await streamInspector.exists(...keys);
        while (remaining > 0 && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          remaining = await streamInspector.exists(...keys);
        }
        socket.end(
          JSON.stringify({ before, armed, hadPositiveTtl, remaining }) + '\n',
        );
        return;
      }
      const run = runs.get(runId);
      if (op === 'shape') {
        socket.end(JSON.stringify(inputShapes.get(runId) ?? null) + '\n');
        return;
      }
      if (op === 'cursor') {
        if (
          typeof cursor !== 'string' ||
          !/^\d{1,9}:\d{1,20}-\d{1,10}$/.test(cursor)
        )
          throw new Error('invalid cursor');
        const redisId = cursor.slice(cursor.indexOf(':') + 1);
        const exists = await streamInspector.xrange(
          `${config.queuePrefix}:{run-streams}:${runId}:events`,
          redisId,
          redisId,
          'COUNT',
          1,
        );
        socket.end(JSON.stringify({ exists: exists.length === 1 }) + '\n');
        return;
      }
      if (op === 'trim') {
        const removed = await streamInspector.xtrim(
          `${config.queuePrefix}:{run-streams}:${runId}:events`,
          'MAXLEN',
          0,
        );
        socket.end(JSON.stringify({ removed }) + '\n');
        return;
      }
      if (op === 'release' && run && !run.released) {
        run.released = true;
        run.blocked = false;
        run.releaseSuffix();
      }
      if (op === 'release-prefix' && run && run.prefixBlocked)
        run.releasePrefix();
      if (op === 'release-answer' && run && run.answerBlocked)
        run.releaseAnswer();
      if (op === 'release-second-answer' && run && run.secondAnswerBlocked)
        run.releaseSecondAnswer();
      socket.end(
        JSON.stringify(
          run
            ? {
                blocked: run.blocked,
                prefixBlocked: run.prefixBlocked,
                answerBlocked: run.answerBlocked,
                secondAnswerBlocked: run.secondAnswerBlocked,
                released: run.released,
              }
            : null,
        ) + '\n',
      );
    } catch {
      socket.end('null\n');
    }
  });
});
await new Promise((resolve, reject) => {
  control.once('error', reject);
  control.listen(socketPath, resolve);
});
await chmod(socketPath, 0o600);

const dynamic = AiWorkerRootModule.forConfig(config);
const testRoot = {
  ...dynamic,
  providers: [
    ...(dynamic.providers ?? []),
    { provide: MODEL_GATEWAY, useValue: createScriptedGateway() },
  ],
};
const app = await NestFactory.createApplicationContext(testRoot, {
  bufferLogs: true,
  abortOnError: false,
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  await streamInspector.quit().catch(() => undefined);
  await new Promise((resolve) => control.close(resolve));
  await rm(socketPath, { force: true });
}
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    void close().catch(() => {
      process.exitCode = 1;
    });
  });
