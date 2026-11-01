import { expect, test } from 'vitest';
import {
  RequestIdentity,
  currentTenantContext,
} from '../../src/modules/identity-access/request-identity.js';
import {
  currentVerifiedIdentity,
  assertVerifiedIdentity,
  type VerifiedIdentity,
} from '../../src/modules/identity-access/identity.types.js';

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const orgId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
test('request identity and tenant context survive async work and expire together', async () => {
  const requests = new RequestIdentity();
  const request = {};
  requests.prepare(
    request,
    {
      identity: {
        userId,
        sessionId,
        activeOrganizationId: orgId,
        channel: 'cookie',
        platformAdmin: false,
        mfaVerifiedAt: null,
        reauthenticatedAt: null,
      },
      tenant: { orgId, userId, role: 'owner' },
      summary: {
        version: 1,
        user: {
          version: 1,
          id: userId,
          name: 'Context user',
          email: 'context@example.test',
          emailVerified: true,
          twoFactorEnabled: false,
          onboardingCompleted: true,
        },
        organization: {
          version: 1,
          id: orgId,
          name: 'Personal',
          slug: 'personal-context',
          kind: 'personal',
          state: 'active',
          require2fa: false,
          role: 'owner',
          createdAt: '2026-11-01T00:00:00.000Z',
        },
      },
    },
    new Headers({ cookie: 'private-test-cookie' }),
  );
  let captured: VerifiedIdentity | undefined;
  await requests.run(request, async () => {
    await Promise.resolve();
    captured = currentVerifiedIdentity();
    expect(currentTenantContext()).toEqual({ orgId, userId, role: 'owner' });
    expect(requests.summary().organization.id).toBe(orgId);
    expect(JSON.stringify(captured)).not.toContain('private-test-cookie');
  });
  expect(() => assertVerifiedIdentity(captured!)).toThrow();
  expect(() => currentTenantContext()).toThrow();
  expect(() => requests.summary()).toThrow();
  await expect(requests.run(request, async () => {})).rejects.toBeDefined();
});
