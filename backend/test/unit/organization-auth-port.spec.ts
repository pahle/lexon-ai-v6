import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { AuthIntegration } from '../../src/infrastructure/db/index.js';
import { OrganizationAuthPort } from '../../src/modules/identity-access/organization-auth.port.js';
import { withVerifiedIdentity } from '../../src/modules/identity-access/identity.types.js';

const facts = {
  userId: randomUUID(),
  sessionId: randomUUID(),
  activeOrganizationId: randomUUID(),
  channel: 'cookie' as const,
  platformAdmin: false,
  mfaVerifiedAt: null,
  reauthenticatedAt: null,
};

it('maps a wrapped lexon_team_owner constraint to ORG_LAST_OWNER', async () => {
  // A driver or pool wrapper carrying its own code must not hide the
  // constraint on the wrapped pg error.
  const integration = {
    transaction: async () => {
      throw { code: 'ERR_WRAPPED', cause: { constraint: 'lexon_team_owner' } };
    },
  } as unknown as AuthIntegration;
  const port = new OrganizationAuthPort(integration);
  await expect(
    withVerifiedIdentity(
      facts,
      (identity) => port.transaction(identity, async () => 'unreachable'),
      new Headers(),
    ),
  ).rejects.toMatchObject({ code: 'ORG_LAST_OWNER', status: 409 });
});

it('retries a wrapped serialization failure then maps exhaustion to AUTH_UNAVAILABLE', async () => {
  let calls = 0;
  const integration = {
    transaction: async () => {
      calls += 1;
      throw { code: 'ERR_WRAPPED', cause: { code: '40001' } };
    },
  } as unknown as AuthIntegration;
  const port = new OrganizationAuthPort(integration);
  await expect(
    withVerifiedIdentity(
      facts,
      (identity) => port.transaction(identity, async () => 'unreachable'),
      new Headers(),
    ),
  ).rejects.toMatchObject({ code: 'AUTH_UNAVAILABLE', status: 503 });
  expect(calls).toBe(3);
});
