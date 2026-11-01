import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';

test('application role reads only the exact non-secret auth projections', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  try {
    expect(await proof.inspect.permittedProjection('user')).toEqual([
      'id',
      'email_verified',
      'two_factor_enabled',
      'role',
      'banned',
    ]);
    expect(await proof.inspect.permittedProjection('organization')).toEqual([
      'id',
      'name',
      'slug',
      'kind',
      'state',
      'require2fa',
      'personal_owner_id',
    ]);
    expect(await proof.inspect.permittedProjection('member')).toEqual([
      'id',
      'user_id',
      'organization_id',
      'role',
    ]);
    for (const target of [
      'email',
      'session',
      'password',
      'totp',
      'recovery',
      'account',
      'invitation',
      'write',
    ]) {
      await expect(
        proof.inspect.forbiddenAppRead(target),
        target,
      ).rejects.toMatchObject({ code: '42501' });
    }
  } finally {
    await proof.close();
  }
});

test('auth role has no app/ops access or ownership escape', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  try {
    for (const action of [
      'app',
      'ops',
      'owner',
      'create',
      'disable',
    ] as const) {
      await expect(
        proof.inspect.forbiddenAuthAction(action),
        action,
      ).rejects.toMatchObject({ code: '42501' });
    }
    const privileges = await proof.inspect.personalFunctionPrivileges();
    expect(privileges).toHaveLength(4);
    for (const privilege of privileges) {
      expect(privilege).toEqual({
        owner: 'lexon_migrator',
        path: 'search_path=pg_catalog, auth, pg_temp',
        appExecute: false,
        authExecute: false,
      });
    }
  } finally {
    await proof.close();
  }
});
