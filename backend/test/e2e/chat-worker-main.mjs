import { createServer } from 'node:net';
import { chmod, rm } from 'node:fs/promises';
import Redis from 'ioredis';
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
      const prefixGate = new Promise((resolve) => {
        releasePrefix = resolve;
      });
      const suffixGate = new Promise((resolve) => {
        releaseSuffix = resolve;
      });
      runs.set(runId, {
        blocked: false,
        prefixBlocked: held,
        released: false,
        releasePrefix,
        releaseSuffix,
      });

      yield {
        type: 'metadata',
        generationId: `e2e-${runId}`,
        provider: 'lexon-e2e-scripted',
      };
      if (prompt.includes('[runtime-proof:reasoning]')) {
        yield { type: 'reasoning-start', attemptId };
        yield {
          type: 'reasoning-summary-delta',
          attemptId,
          text: 'Synthetic reasoning summary.',
        };
        yield { type: 'reasoning-end', attemptId, durationMs: 17 };
      }
      if (held) {
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
        const answer = prompt.includes('[runtime-proof:reasoning]')
          ? 'Reasoned synthetic answer.'
          : prompt.includes('[runtime-proof:error]')
            ? 'Try again succeeded.'
            : prompt.includes('[runtime-proof:edit]')
              ? 'Edited answer.'
              : prompt.includes('[runtime-proof:regenerate]')
                ? `Sibling answer ${count}.`
                : `Scripted answer: ${prompt.replace(/\[runtime-proof:[^\]]+\]/g, '').trim()}`;
        const parts = held
          ? []
          : [...answer].map((text) => ({ type: 'text', text }));
        for (const part of parts) yield part;
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
  socket.setTimeout(1500, () => socket.destroy());
  let buffer = '';
  socket.on('data', async (chunk) => {
    buffer += chunk;
    if (buffer.length > 512) return socket.destroy();
    if (!buffer.includes('\n')) return;
    try {
      const { op, runId } = JSON.parse(buffer.split('\n')[0]);
      if (
        ![
          'status',
          'release-prefix',
          'release',
          'cursor',
          'trim',
          'shape',
        ].includes(op) ||
        typeof runId !== 'string' ||
        !/^[0-9a-f-]{36}$/.test(runId)
      )
        throw new Error('invalid control command');
      const run = runs.get(runId);
      if (op === 'shape') {
        socket.end(JSON.stringify(inputShapes.get(runId) ?? null) + '\n');
        return;
      }
      if (op === 'cursor') {
        const cursor = JSON.parse(buffer.split('\n')[0]).cursor;
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
      socket.end(
        JSON.stringify(
          run
            ? {
                blocked: run.blocked,
                prefixBlocked: run.prefixBlocked,
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
