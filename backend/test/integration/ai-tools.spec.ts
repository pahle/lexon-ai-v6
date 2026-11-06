import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import {
  createAiFixture,
  queryAiTestSession,
  recordAiTestToolEffect,
  sleepInAiTestSession,
} from '../../src/infrastructure/db/testing/ai-fixture.js';
import {
  AiOperationRepository,
  hashOperationArgs,
  jsonbTextBytes,
  TenantTransactionTimeoutError,
} from '../../src/infrastructure/db/index.js';
import { canonicalOperationHash } from '../../src/modules/chat/canonical-operation.js';

test('proposal persistence deduplicates replay but keeps identical intentional calls distinct', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const claim = await ai.claim(0, run.id, 1, 1, 5_000);
    expect(claim).not.toBeNull();
    const operations = new AiOperationRepository();
    const args = { value: 'same arguments' };
    const argsHash = hashOperationArgs(args);
    const snapshotHash = canonicalOperationHash({
      toolId: 'fixture-write',
      toolVersion: 1,
      args,
    });
    const persisted = await ai.withTenant(0, async (tx) => {
      const first = await operations.persist(tx, claim!, {
        callOccurrence: 0,
        toolName: 'fixture-write',
        toolVersion: 1,
        mode: 'transactional',
        args,
        argsHash,
        snapshotHash,
        approvalRequired: false,
      });
      const replay = await operations.persist(tx, claim!, {
        callOccurrence: 0,
        toolName: 'fixture-write',
        toolVersion: 1,
        mode: 'transactional',
        args,
        argsHash,
        snapshotHash,
        approvalRequired: false,
      });
      const second = await operations.persist(tx, claim!, {
        callOccurrence: 1,
        toolName: 'fixture-write',
        toolVersion: 1,
        mode: 'transactional',
        args,
        argsHash,
        snapshotHash,
        approvalRequired: false,
      });
      const identityConflict = await operations
        .persist(tx, claim!, {
          callOccurrence: 0,
          toolName: 'fixture-write',
          toolVersion: 2,
          mode: 'transactional',
          args,
          argsHash,
          snapshotHash: canonicalOperationHash({
            toolId: 'fixture-write',
            toolVersion: 2,
            args,
          }),
          approvalRequired: false,
        })
        .catch((error: Error) => error.message);
      return { first, replay, second, identityConflict };
    });
    expect(persisted.replay.id).toBe(persisted.first.id);
    expect(persisted.second.id).not.toBe(persisted.first.id);
    expect(persisted.second.args).toEqual(persisted.first.args);
    expect(persisted.identityConflict).toBe('AI operation occurrence conflict');
  } finally {
    await ai.close();
  }
});

test('operation arguments exceeding JSONB text storage bounds fail before insert', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const claim = await ai.claim(0, run.id, 1, 1, 5000);
    expect(claim).not.toBeNull();
    const args = Array.from({ length: 6000 }, () => 0);
    const repository = new AiOperationRepository();

    await expect(
      ai.withTenant(0, (tx) =>
        repository.persist(tx, claim!, {
          callOccurrence: 0,
          toolName: 'fixture-write',
          toolVersion: 1,
          mode: 'transactional',
          args,
          argsHash: hashOperationArgs(args),
          snapshotHash: canonicalOperationHash({
            toolId: 'fixture-write',
            toolVersion: 1,
            args,
          }),
          approvalRequired: false,
        }),
      ),
    ).rejects.toThrow('Invalid AI operation proposal');
    expect(
      await ai.withTenant(0, (tx) =>
        repository.forRun(tx, { runId: run.id, throughSequence: 2 }),
      ),
    ).toEqual([]);
  } finally {
    await ai.close();
  }
});

test('JSONB storage byte estimator matches PostgreSQL text for arrays and exponent numbers', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const values = [
      Array.from({ length: 6000 }, () => 0),
      { nested: ['legal 🧾', { value: 1e100, tiny: 1e-100 }] },
      { negativeZero: -0, decimal: 1.25, unicode: 'é' },
    ];
    for (const value of values) {
      const actual = await ai.jsonbStorageBytes(0, value);
      expect(jsonbTextBytes(value)).toBe(actual);
    }
  } finally {
    await ai.close();
  }
});

test('operation receipt, effect and result roll back together', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    await ai.seedPendingStep(0, run.id);
    const claim = await ai.claim(0, run.id, 1, 1, 5_000);
    expect(claim).not.toBeNull();
    const operations = new AiOperationRepository();
    const args = { value: 'rollback me' };
    const operationId = await ai
      .withTenant(0, async (tx) => {
        const operation = await operations.persist(tx, claim!, {
          callOccurrence: 0,
          toolName: 'fixture-write',
          toolVersion: 1,
          mode: 'transactional',
          args,
          argsHash: hashOperationArgs(args),
          snapshotHash: canonicalOperationHash({
            toolId: 'fixture-write',
            toolVersion: 1,
            args,
          }),
          approvalRequired: false,
        });
        await recordAiTestToolEffect(tx, operation.id, args.value);
        await operations.complete(tx, operation.id, {
          status: 'succeeded',
          result: { stored: true },
        });
        throw new Error('force rollback');
      })
      .catch((error: Error) => {
        expect(error.message).toBe('force rollback');
        return 'rolled-back';
      });
    expect(operationId).toBe('rolled-back');
    expect(await ai.toolEffectCount(0)).toBe(0);
    expect(
      await ai.withTenant(0, (tx) =>
        operations.forRun(tx, {
          runId: run.id,
          throughSequence: 2,
        }),
      ),
    ).toEqual([]);
  } finally {
    await ai.close();
  }
});

test('tool transaction deadline rolls back a pending statement and leaves the pool usable', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    await expect(
      ai.database.withTenant(
        ai.tenants[0]!,
        async (tx) => {
          await sleepInAiTestSession(tx, 5);
        },
        { timeoutMs: 100 },
      ),
    ).rejects.toBeInstanceOf(TenantTransactionTimeoutError);
    expect(await ai.database.check()).toBe('up');
  } finally {
    await ai.close();
  }
});

test('tool transaction deadline expires its session before a paused callback resumes', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    let sessionExpired = false;
    await expect(
      ai.database.withTenant(
        ai.tenants[0]!,
        async (tx) => {
          await new Promise((resolve) => setTimeout(resolve, 150));
          try {
            await queryAiTestSession(tx);
          } catch (error) {
            sessionExpired =
              (error as Error).message === 'Tenant session expired';
            throw error;
          }
        },
        { timeoutMs: 75 },
      ),
    ).rejects.toThrow('Tenant transaction timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sessionExpired).toBe(true);
    expect(await ai.database.check()).toBe('up');
  } finally {
    await ai.close();
  }
});

test('tool transaction deadline supervises a callback that never settles', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    await expect(
      ai.database.withTenant(
        ai.tenants[0]!,
        async () => new Promise<never>(() => undefined),
        { timeoutMs: 75 },
      ),
    ).rejects.toThrow('Tenant transaction timed out');
    expect(await ai.database.check()).toBe('up');
  } finally {
    await ai.close();
  }
});
