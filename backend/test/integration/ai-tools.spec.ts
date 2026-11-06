import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import {
  aiTestBackendPid,
  createAiFixture,
  holdAiTestTransactionLock,
  queryAiTestSession,
  recordAiTestToolEffect,
  sleepInAiTestSession,
} from '../../src/infrastructure/db/testing/ai-fixture.js';
import {
  AiOperationRepository,
  hashOperationArgs,
  jsonbTextBytes,
  TenantTransactionTimeoutError,
  TenantDatabase,
} from '../../src/infrastructure/db/index.js';
import { canonicalOperationHash } from '../../src/modules/chat/canonical-operation.js';
import { FaultProxy } from '../../src/infrastructure/queue/testing/fault-proxy.js';

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

test('wall-clock transaction timeout destroys a blackholed established connection before returning', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const proxy = await FaultProxy.start(services.appUrl);
  const database = new TenantDatabase({
    appUrl: proxy.url,
    poolMax: 1,
    statementTimeoutMs: 20000,
  });
  let setPid!: (pid: number) => void;
  const pidReady = new Promise<number>((resolve) => {
    setPid = resolve;
  });
  const operation = database
    .withTenant(
      ai.tenants[0]!,
      async (tx) => {
        await holdAiTestTransactionLock(tx);
        const pid = await aiTestBackendPid(tx);
        setPid(pid);
        await sleepInAiTestSession(tx, 20);
      },
      { timeoutMs: 1500 },
    )
    .then(
      () => 'completed',
      () => 'timed-out',
    );
  try {
    const pid = await pidReady;
    expect(await ai.waitForBackendLock(pid, true)).toBe(true);
    proxy.hang();
    const result = await Promise.race([
      operation,
      new Promise<'still-blocked'>((resolve) =>
        setTimeout(() => resolve('still-blocked'), 2500),
      ),
    ]);
    expect(result).toBe('timed-out');
    expect(await ai.waitForBackendExit(pid)).toBe(true);
  } finally {
    proxy.restore();
    await operation;
    await database.close();
    await proxy.close();
    await ai.close();
  }
});

test('wall-clock timeout destroys blackholed idle transaction during a paused callback', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const proxy = await FaultProxy.start(services.appUrl);
  const database = new TenantDatabase({
    appUrl: proxy.url,
    poolMax: 1,
    statementTimeoutMs: 20000,
  });
  let setReady!: (pid: number) => void;
  const ready = new Promise<number>((resolve) => {
    setReady = resolve;
  });
  let releaseCallback!: () => void;
  const callbackGate = new Promise<void>((resolve) => {
    releaseCallback = resolve;
  });
  const operation = database
    .withTenant(
      ai.tenants[0]!,
      async (tx) => {
        await queryAiTestSession(tx);
        setReady(await aiTestBackendPid(tx));
        await callbackGate;
      },
      { timeoutMs: 1500 },
    )
    .then(
      () => 'completed' as const,
      () => 'timed-out' as const,
    );
  try {
    const pid = await ready;
    proxy.hang();
    const result = await Promise.race([
      operation,
      new Promise<'still-blocked'>((resolve) =>
        setTimeout(() => resolve('still-blocked'), 2500),
      ),
    ]);
    expect(result).toBe('timed-out');
    proxy.restore();
    expect(await ai.waitForBackendExit(pid)).toBe(true);
  } finally {
    proxy.restore();
    releaseCallback();
    await operation;
    await database.close();
    await proxy.close();
    await ai.close();
  }
});

test('wall-clock deadline destroys a reused pool connection blocked before the next BEGIN', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  const proxy = await FaultProxy.start(services.appUrl);
  const database = new TenantDatabase({
    appUrl: proxy.url,
    poolMax: 1,
    statementTimeoutMs: 5000,
  });
  let operation: Promise<'completed' | 'timed-out'> | undefined;
  try {
    const tenant = ai.tenants[0]!;
    const pid = await database.withTenant(tenant, (tx) => aiTestBackendPid(tx));
    proxy.hang();
    const started = Date.now();
    operation = database
      .withTenant(tenant, queryAiTestSession, { timeoutMs: 1500 })
      .then(
        () => 'completed' as const,
        (error: unknown) => {
          expect(error).toBeInstanceOf(TenantTransactionTimeoutError);
          return 'timed-out' as const;
        },
      );
    const outcome = await Promise.race([
      operation,
      new Promise<'still-blocked'>((resolve) =>
        setTimeout(() => resolve('still-blocked'), 2500),
      ),
    ]);
    expect(outcome).toBe('timed-out');
    expect(Date.now() - started).toBeLessThan(2500);
    proxy.restore();
    expect(await ai.waitForBackendExit(pid)).toBe(true);
    await expect(
      database.withTenant(tenant, queryAiTestSession, { timeoutMs: 1500 }),
    ).resolves.toBeUndefined();
  } finally {
    proxy.restore();
    if (operation) await operation;
    await database.close();
    await proxy.close();
    await ai.close();
  }
});
