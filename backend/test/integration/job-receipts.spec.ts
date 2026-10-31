import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import {
  TenantDatabase,
  OutboxRepository,
  ProcessedJobsRepository,
  type TenantSession,
} from '../../src/infrastructure/db/index.js';
import {
  JobExecutor,
  parseJobEnvelope,
  type JobEnvelope,
} from '../../src/modules/platform/index.js';
import {
  installEffectFixture,
  createEffectHandler,
  inspectJob,
  receiptWaiters,
} from '../../src/infrastructure/db/testing/job-effects.js';
import { observeContext } from '../../src/infrastructure/db/testing/tenant-fixture.js';

const ctx = { orgId: randomUUID(), userId: randomUUID() };
const job = (): JobEnvelope => ({
  outboxId: randomUUID(),
  type: 'platform.noop.v1',
  ctx,
  payload: { probeId: randomUUID() },
});
const gate = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
test.beforeAll(async ({ services }) => {
  await installEffectFixture(services);
});
function database(appUrl: string) {
  return new TenantDatabase({ appUrl, poolMax: 3, statementTimeoutMs: 10000 });
}

test('receipt and effect commit together; duplicates never invoke the handler and sessions expire', async ({
  services,
}) => {
  const db = database(services.appUrl);
  const executor = new JobExecutor(db);
  const input = job();
  let captured: TenantSession | undefined;
  try {
    expect(
      await executor.execute(input, async (tx, j) => {
        captured = tx;
        expect(await observeContext(tx)).toEqual(ctx);
        await createEffectHandler()(tx, j);
        expect(await inspectJob(services, input.outboxId)).toMatchObject({
          effects: 0,
          receipts: 0,
        });
      }),
    ).toBe('processed');
    expect(
      await executor.execute(input, async () => {
        throw new Error('must not run');
      }),
    ).toBe('duplicate');
    expect(await inspectJob(services, input.outboxId)).toMatchObject({
      effects: 1,
      receipts: 1,
    });
    await expect(
      new ProcessedJobsRepository().tryRecord(captured!, randomUUID()),
    ).rejects.toThrow('expired');
  } finally {
    await db.close();
  }
});

test('throwing handler rolls back receipt and effect, permitting a later attempt', async ({
  services,
}) => {
  const db = database(services.appUrl);
  const executor = new JobExecutor(db);
  const input = job();
  try {
    await expect(
      executor.execute(input, async (tx, j) => {
        await createEffectHandler()(tx, j);
        throw new Error('fixture rollback');
      }),
    ).rejects.toThrow('fixture rollback');
    expect(await inspectJob(services, input.outboxId)).toMatchObject({
      effects: 0,
      receipts: 0,
    });
    expect(await executor.execute(input, createEffectHandler())).toBe(
      'processed',
    );
    expect(await inspectJob(services, input.outboxId)).toMatchObject({
      effects: 1,
      receipts: 1,
    });
  } finally {
    await db.close();
  }
});

for (const rollback of [false, true])
  test(`concurrent receipt waits for winner ${rollback ? 'rollback' : 'commit'}`, async ({
    services,
  }) => {
    const db = database(services.appUrl);
    const executor = new JobExecutor(db);
    const input = job();
    const entered = gate();
    const release = gate();
    let secondCalls = 0;
    const first = executor
      .execute(input, async (tx, j) => {
        await createEffectHandler()(tx, j);
        entered.resolve();
        await release.promise;
        if (rollback) throw new Error('rollback');
      })
      .then(
        (value) => value,
        () => 'rolled-back',
      );
    await entered.promise;
    const second = executor.execute(input, async (tx, j) => {
      secondCalls++;
      await createEffectHandler()(tx, j);
    });
    try {
      await expect.poll(() => receiptWaiters(services)).toBeGreaterThan(0);
      expect(secondCalls).toBe(0);
      release.resolve();
      expect(await first).toBe(rollback ? 'rolled-back' : 'processed');
      expect(await second).toBe(rollback ? 'processed' : 'duplicate');
      expect(await inspectJob(services, input.outboxId)).toMatchObject({
        effects: 1,
        receipts: 1,
      });
    } finally {
      release.resolve();
      await Promise.allSettled([first, second]);
      await db.close();
    }
  });

test('outbox append is tenant-bound and rolls back with its transaction', async ({
  services,
}) => {
  const db = database(services.appUrl);
  const repository = new OutboxRepository();
  let id = '';
  try {
    await expect(
      db.withTenant(ctx, async (tx) => {
        id = await repository.append(tx, {
          type: 'platform.noop.v1',
          ctx,
          payload: { probeId: randomUUID() },
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect((await inspectJob(services, id)).outbox).toBe(0);
    await db.withTenant(ctx, async (tx) => {
      id = await repository.append(tx, {
        type: 'platform.noop.v1',
        ctx,
        payload: { probeId: randomUUID() },
      });
    });
    expect((await inspectJob(services, id)).outbox).toBe(1);
    await expect(
      db.withTenant(ctx, (tx) =>
        repository.append(tx, {
          type: 'platform.noop.v1',
          ctx: { orgId: randomUUID() },
          payload: { probeId: randomUUID() },
        }),
      ),
    ).rejects.toThrow('context');
  } finally {
    await db.close();
  }
});

test('invalid job metadata is sanitized before any handler runs; parsed metadata is deeply immutable', async ({
  services,
}) => {
  const db = database(services.appUrl);
  const executor = new JobExecutor(db);
  let calls = 0;
  try {
    for (const invalid of [
      { ...job(), outboxId: 'secret-invalid' },
      { ...job(), type: 'secret-type' },
      { ...job(), ctx: { orgId: 'secret-org' } },
      { ...job(), payload: { probeId: 'secret-payload' } },
      { ...job(), payload: { probeId: randomUUID(), text: 'secret-content' } },
    ]) {
      await expect(
        executor.execute(invalid as JobEnvelope, async () => {
          calls++;
        }),
      ).rejects.toThrow(/^Invalid job envelope$/);
    }
    expect(calls).toBe(0);
    const parsed = parseJobEnvelope(job());
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.ctx)).toBe(true);
    expect(Object.isFrozen(parsed.payload)).toBe(true);
  } finally {
    await db.close();
  }
});
