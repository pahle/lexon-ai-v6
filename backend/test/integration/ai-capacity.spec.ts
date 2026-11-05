import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAiFixture } from '../../src/infrastructure/db/testing/ai-fixture.js';

test('the 24th admitted run is accepted and the 25th is refused across five organizations', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    for (let org = 0; org < 4; org++)
      for (let count = 0; count < 6; count++) await ai.start(org);
    expect(await ai.admittedRunCount()).toBe(24);
    await expect(ai.start(4)).rejects.toThrow();
    expect(await ai.losingStartCounts(4)).toEqual({
      runs: 0,
      outbox: 0,
      slots: 0,
    });
  } finally {
    await ai.close();
  }
});

test('organization A at six is refused while organization B can still start', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    for (let count = 0; count < 6; count++) await ai.start(0);
    const before = await ai.losingStartCounts(0);
    await expect(ai.start(0)).rejects.toThrow();
    expect(await ai.losingStartCounts(0)).toEqual(before);
    expect(await ai.start(1)).toBeTruthy();
  } finally {
    await ai.close();
  }
});

test('terminal status releases the organization slot exactly once', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    const run = await ai.start(0);
    expect(await ai.transition(0, run.id, 1, 'queued', 'running')).toBe(true);
    expect(await ai.transition(0, run.id, 2, 'running', 'completed')).toBe(
      true,
    );
    expect(await ai.transition(0, run.id, 3, 'completed', 'failed')).toBe(
      false,
    );
    for (let count = 0; count < 6; count++) await ai.start(0);
    expect(await ai.orgSlotCount(0)).toBe(6);
  } finally {
    await ai.close();
  }
});

test('two independent connections compete for the final global slot', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    for (let org = 0; org < 3; org++)
      for (let count = 0; count < 6; count++) await ai.start(org);
    for (let count = 0; count < 5; count++) await ai.start(3);
    const results = await Promise.allSettled([ai.start(4), ai.start(5)]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const loser = results[0]?.status === 'rejected' ? 4 : 5;
    expect(await ai.losingStartCounts(loser)).toEqual({
      runs: 0,
      outbox: 0,
      slots: 0,
    });
    expect(await ai.admittedRunCount()).toBe(24);
  } finally {
    await ai.close();
  }
});

test('rollback releases admission and approval pause retains its active slot', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    await expect(ai.startThenRollback(0)).rejects.toThrow();
    expect(await ai.losingStartCounts(0)).toEqual({
      runs: 0,
      outbox: 0,
      slots: 0,
    });
    expect(await ai.orgSlotCount(0)).toBe(0);
    const run = await ai.start(0);
    expect(await ai.transition(0, run.id, 1, 'queued', 'running')).toBe(true);
    expect(
      await ai.transition(0, run.id, 2, 'running', 'awaiting_approval'),
    ).toBe(true);
    for (let count = 0; count < 5; count++) await ai.start(0);
    await expect(ai.start(0)).rejects.toThrow();
    expect(await ai.orgSlotCount(0)).toBe(6);
  } finally {
    await ai.close();
  }
});

test('capacity configuration refuses inconsistent process limits', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    await expect(ai.configureMismatchedCapacity()).rejects.toThrow();
  } finally {
    await ai.close();
  }
});

test('runtime capacity role cannot update or delete its configuration', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    expect(await ai.capacityMutationSqlStates()).toEqual({
      update: '42501',
      deletion: '42501',
    });
  } finally {
    await ai.close();
  }
});

test('independent capacity repository compares the existing fingerprint safely', async ({
  services,
}) => {
  const ai = await createAiFixture(services);
  try {
    await expect(ai.configureCapacityFromIndependentRepository()).resolves.toBe(
      undefined,
    );
    await expect(ai.configureMismatchedCapacity()).rejects.toThrow(
      'AI capacity configuration mismatch',
    );
  } finally {
    await ai.close();
  }
});
