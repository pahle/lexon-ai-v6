import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';

const signup = () => ({
  body: {
    name: 'Personal test',
    email: `${randomUUID()}@example.test`,
    password: 'Personal-password-42!',
  },
});

test('signup creates one Personal with its sole owner and no partial visibility', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const input = signup();
  try {
    const user = await proof.integration.transaction(async (tx) => {
      const result = await tx.call('signUpEmail', input);
      expect(await proof.inspect.countUsers(input.body.email)).toBe(0);
      expect(await proof.inspect.personalFor(result.user.id)).toBeNull();
      return result.user;
    });
    expect(await proof.inspect.personalFor(user.id)).toMatchObject({
      userId: user.id,
      role: 'owner',
      memberCount: 1,
    });
  } finally {
    await proof.close();
  }
});

for (const stage of ['account', 'organization', 'member'] as const) {
  test(`failure inserting ${stage} rolls back user, Personal and membership`, async ({
    services,
  }) => {
    const proof = await createAuthFixture(services);
    try {
      const before = await proof.inspect.totals();
      await proof.inspect.rejectInsert(stage);
      await expect(
        proof.integration.transaction((tx) => tx.call('signUpEmail', signup())),
      ).rejects.toThrow();
      expect(await proof.inspect.totals()).toEqual(before);
    } finally {
      await proof.close();
    }
  });
}

test('a failure after native signup leaves neither account nor Personal', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  try {
    const before = await proof.inspect.totals();
    await expect(
      proof.integration.transaction(async (tx) => {
        await tx.call('signUpEmail', signup());
        throw new Error('after-user-insert');
      }),
    ).rejects.toThrow('after-user-insert');
    expect(await proof.inspect.totals()).toEqual(before);
  } finally {
    await proof.close();
  }
});

test('runtime callers cannot mutate, delete, duplicate or share Personal', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  try {
    const user = await proof.integration.transaction((tx) =>
      tx.call('signUpEmail', signup()),
    );
    const other = await proof.integration.transaction((tx) =>
      tx.call('signUpEmail', signup()),
    );
    expect(await proof.inspect.personalFor(user.user.id)).not.toBeNull();
    for (const action of [
      'rename',
      'convert',
      'owner',
      'delete',
      'leave',
      'demote',
      'add',
      'duplicateMember',
      'invite',
      'duplicate',
    ]) {
      await expect(
        proof.inspect.changePersonal(user.user.id, other.user.id, action),
        action,
      ).rejects.toMatchObject({
        code:
          action === 'duplicate' || action === 'duplicateMember'
            ? '23505'
            : '23514',
      });
    }
    expect(await proof.inspect.personalFor(user.user.id)).toMatchObject({
      userId: user.user.id,
      role: 'owner',
      memberCount: 1,
    });
  } finally {
    await proof.close();
  }
});
