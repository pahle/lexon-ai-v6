import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import {
  TenantDatabase,
  type AuthCommandSession,
} from '../../src/infrastructure/db/index.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { createAuditInspector } from '../../src/infrastructure/db/testing/audit-fixture.js';
import {
  AuditService,
  appendAuthAudit,
  type OrgAuditEvent,
} from '../../src/modules/audit/index.js';

const failed = () => ({
  version: 1 as const,
  eventId: randomUUID(),
  type: 'identity.sign_in_failed.v1' as const,
  occurredAt: new Date().toISOString(),
  outcome: 'failure' as const,
  metadata: {
    subjectHmac: 'a'.repeat(64),
    keyId: 'test-v1',
    reason: 'invalid_credentials' as const,
  },
});
const orgEvent = (orgId: string) => ({
  version: 1 as const,
  eventId: randomUUID(),
  type: 'organization.created.v1' as const,
  occurredAt: new Date().toISOString(),
  outcome: 'success' as const,
  orgId,
  actorUserId: randomUUID(),
  metadata: { kind: 'team' as const, source: 'user' as const },
});

test('app tenant writer requires matching org; auth writer accepts events without a tenant', async ({
  services,
}) => {
  const inspect = createAuditInspector(services);
  const proof = await createAuthFixture(services);
  const db = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 1,
    statementTimeoutMs: 5000,
  });
  const audit = new AuditService();
  const orgId = randomUUID();
  try {
    const before = await inspect.count('organization.created.v1');
    await db.withTenant({ orgId }, (tx) => audit.append(tx, orgEvent(orgId)));
    await expect(
      db.withTenant({ orgId }, (tx) =>
        audit.append(tx, orgEvent(randomUUID())),
      ),
    ).rejects.toThrow();
    await expect(
      db.withTenant({ orgId }, (tx) =>
        audit.append(tx, failed() as unknown as OrgAuditEvent),
      ),
    ).rejects.toThrow();
    expect(await inspect.count('organization.created.v1')).toBe(before + 1);
    const attempts = await inspect.count('identity.sign_in_failed.v1');
    await proof.integration.transaction((tx) => appendAuthAudit(tx, failed()));
    expect(await inspect.count('identity.sign_in_failed.v1')).toBe(
      attempts + 1,
    );
    const setupCount = await inspect.count('platform.admin_setup_invoked.v1');
    await proof.integration.transaction((tx) =>
      appendAuthAudit(tx, {
        version: 1,
        eventId: randomUUID(),
        type: 'platform.admin_setup_invoked.v1',
        occurredAt: new Date().toISOString(),
        outcome: 'success',
        metadata: {
          additional: false,
          status: 'pending',
          subjectHmac: 'a'.repeat(64),
          keyId: 'test-v1',
        },
      }),
    );
    expect(await inspect.count('platform.admin_setup_invoked.v1')).toBe(
      setupCount + 1,
    );
  } finally {
    await Promise.all([inspect.close(), proof.close(), db.close()]);
  }
});

test('audit table and function preserve narrow append-only runtime grants', async ({
  services,
}) => {
  const inspect = createAuditInspector(services);
  try {
    await inspect.appendRaw('app', failed());
    await inspect.appendRaw('auth', failed());
    await inspect.appendDirect(failed());
    await expect(
      inspect.appendDirect({
        ...failed(),
        metadata: { error: 'secret-sentinel' },
      }),
    ).rejects.toMatchObject({ code: '23514' });
    for (const role of ['app', 'auth'] as const) {
      for (const operation of [
        'SELECT',
        'UPDATE',
        'DELETE',
        'TRUNCATE',
      ] as const)
        await expect(inspect.forbidden(role, operation)).rejects.toMatchObject({
          code: '42501',
        });
    }
    await expect(inspect.forbidden('auth', 'INSERT')).rejects.toMatchObject({
      code: '42501',
    });
    expect(await inspect.security()).toEqual({
      owner: 'lexon_migrator',
      path: 'search_path=pg_catalog, auth, pg_temp',
      publicExecute: false,
      appExecute: true,
      authExecute: true,
    });
    for (const invalid of [
      { ...failed(), type: 'unknown.v1' },
      { ...failed(), actorUserId: 'bad' },
      { ...failed(), email: 'person@example.test' },
      { ...failed(), metadata: { email: 'person@example.test' } },
      { ...failed(), metadata: { error: 'secret-sentinel' } },
      { ...failed(), metadata: { url: 'https://example.test/?token=secret' } },
      { ...failed(), metadata: { ip: '127.0.0.1' } },
      { ...failed(), subjectUserId: randomUUID() },
    ])
      await expect(inspect.appendRaw('auth', invalid)).rejects.toMatchObject({
        code: '23514',
      });
  } finally {
    await inspect.close();
  }
});

test('auth audit capability expires when its transaction callback exits', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  let retained: AuthCommandSession | undefined;
  try {
    await proof.integration.transaction(async (tx) => {
      retained = tx;
    });
    await expect(appendAuthAudit(retained!, failed())).rejects.toThrow(
      'Auth command session expired',
    );
  } finally {
    await proof.close();
  }
});

test('auth state and success audit roll back together; independent failure attempt survives', async ({
  services,
}) => {
  const inspect = createAuditInspector(services);
  const proof = await createAuthFixture(services);
  const input = {
    body: {
      name: 'Audit test',
      email: `${randomUUID()}@example.test`,
      password: 'Audit-password-42!',
    },
  };
  try {
    const before = await inspect.count('identity.sign_in_failed.v1');
    await proof.integration.transaction((tx) => appendAuthAudit(tx, failed()));
    await expect(
      proof.integration.transaction(async (tx) => {
        await tx.call('signUpEmail', input);
        await appendAuthAudit(tx, failed());
        throw new Error('rollback-audit');
      }),
    ).rejects.toThrow('rollback-audit');
    expect(await inspect.count('identity.sign_in_failed.v1')).toBe(before + 1);
    expect(await proof.inspect.countUsers(input.body.email)).toBe(0);
    await inspect.rejectInserts();
    await expect(
      proof.integration.transaction(async (tx) => {
        await tx.call('signUpEmail', input);
        await appendAuthAudit(tx, failed());
      }),
    ).rejects.toThrow();
    expect(await proof.inspect.countUsers(input.body.email)).toBe(0);
  } finally {
    await Promise.all([inspect.close(), proof.close()]);
  }
});
