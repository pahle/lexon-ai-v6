import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import {
  TenantDatabase,
  type TenantSession,
} from '../../src/infrastructure/db/index.js';
import {
  installTenantFixture,
  tenantFixture,
  roleRestrictions,
  observeContext,
  sleepInTransaction,
} from '../../src/infrastructure/db/testing/tenant-fixture.js';
import { unscopedProbe } from '../../src/infrastructure/db/testing/unscoped-probe.js';

const A = {
  orgId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  userId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
};
const B = { orgId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
const idA = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const idB = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';

test.beforeAll(async ({ services }) => {
  await installTenantFixture(services);
});

test('fails closed on fresh and reused connections after commit and rollback', async ({
  services,
}) => {
  expect(await unscopedProbe({ appUrl: services.appUrl })).toEqual([]);
  expect(
    await unscopedProbe({ appUrl: services.appUrl, reuseAfter: A }),
  ).toEqual([]);
  expect(
    await unscopedProbe({
      appUrl: services.appUrl,
      reuseAfter: A,
      rollback: true,
    }),
  ).toEqual([]);
});

test('cannot read, update, delete or insert another organization rows', async ({
  services,
}) => {
  const db = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 1,
    statementTimeoutMs: 10000,
  });
  try {
    await db.withTenant(A, async (tx) => {
      await tenantFixture(tx).insert(idA, A.orgId, 'A');
    });
    await db.withTenant(B, async (tx) => {
      await tenantFixture(tx).insert(idB, B.orgId, 'B');
    });
    await db.withTenant(A, async (tx) => {
      expect(await tenantFixture(tx).read()).toEqual([{ id: idA, value: 'A' }]);
      expect(await tenantFixture(tx).update(idB, 'intrusion')).toBe(0);
      expect(await tenantFixture(tx).delete(idB)).toBe(0);
    });
    await expect(
      db.withTenant(A, (tx) =>
        tenantFixture(tx).insert(
          'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
          B.orgId,
          'intrusion',
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await db.withTenant(B, async (tx) => {
      expect(await tenantFixture(tx).read()).toEqual([{ id: idB, value: 'B' }]);
    });
  } finally {
    await db.close();
  }
});

test('rejects absent/invalid context and expires a captured session', async ({
  services,
}) => {
  const db = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 1,
    statementTimeoutMs: 10000,
  });
  try {
    await expect(
      db.withTenant({ orgId: '' }, async () => undefined),
    ).rejects.toThrow('orgId');
    await expect(
      db.withTenant({ ...A, userId: 'invalid' }, async () => undefined),
    ).rejects.toThrow('userId');
    let captured: TenantSession | undefined;
    await db.withTenant(A, async (tx) => {
      captured = tx;
      expect(await observeContext(tx)).toEqual({
        orgId: A.orgId,
        userId: A.userId,
      });
    });
    await expect(observeContext(captured!)).rejects.toThrow('expired');
    await db.withTenant(B, async (tx) => {
      expect(await observeContext(tx)).toEqual({ orgId: B.orgId, userId: '' });
    });
  } finally {
    await db.close();
  }
});

test('rolls back effects and recovers its size-one pool after a statement timeout', async ({
  services,
}) => {
  const db = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 1,
    statementTimeoutMs: 50,
  });
  try {
    await expect(
      db.withTenant(A, async (tx) => {
        await tenantFixture(tx).insert(
          'aaaaaaaa-aaaa-4aaa-8aaa-000000000003',
          A.orgId,
          'rollback',
        );
        await sleepInTransaction(tx);
      }),
    ).rejects.toMatchObject({ code: '57014' });
    await db.withTenant(A, async (tx) => {
      expect(
        (await tenantFixture(tx).read()).some(
          (row) => row.value === 'rollback',
        ),
      ).toBe(false);
    });
  } finally {
    await db.close();
  }
});

test('the runtime role cannot change RLS, truncate tables, read auth secrets or assume privileged roles', async ({
  services,
}) => {
  expect(await roleRestrictions(services)).toEqual({
    disableRls: false,
    truncate: false,
    alter: false,
    readAuthSecret: false,
    assumeMigrator: false,
    assumeAuth: false,
    owner: false,
    bypassRls: false,
  });
});
