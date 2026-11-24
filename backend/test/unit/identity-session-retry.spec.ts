import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import type {
  AuthCommandSession,
  AuthIntegration,
} from '../../src/infrastructure/db/index.js';
import { IdentitySessionService } from '../../src/modules/identity-access/identity-session.service.js';
import { IdentityError } from '../../src/modules/identity-access/identity-error.js';
import { withVerifiedIdentity } from '../../src/modules/identity-access/identity.types.js';

const userId = randomUUID();
const sessionId = randomUUID();
const personalOrgId = randomUUID();
const teamOrgId = randomUUID();
const memberId = randomUUID();

function organization(id: string, kind: 'personal' | 'team') {
  return {
    id,
    name: kind === 'personal' ? 'Personal' : 'Fixture team',
    slug: kind === 'personal' ? 'personal' : 'fixture-team',
    kind,
    state: 'active',
    require2fa: false,
    createdAt: new Date('2026-11-01T00:00:00Z'),
  };
}
const session = {
  id: sessionId,
  userId,
  channel: 'cookie',
  activeOrganizationId: personalOrgId,
  activeOrganizationName: 'Personal',
  pendingOrganizationId: null,
  selectionVersion: 1,
  mfaVerifiedAt: null,
  hardExpiresAt: null,
  reauthenticatedAt: null,
};
const securityFacts = {
  user: {
    id: userId,
    banned: false,
    emailVerified: true,
    twoFactorEnabled: false,
    role: null,
  },
  session,
};
const currentFacts = {
  session,
  personal: organization(personalOrgId, 'personal'),
  personalMember: {
    id: memberId,
    userId,
    organizationId: personalOrgId,
    role: 'owner',
  },
  selected: organization(personalOrgId, 'personal'),
  selectedMember: {
    id: memberId,
    userId,
    organizationId: personalOrgId,
    role: 'owner',
  },
  selectedMemberCount: 1,
};
const targetFacts = {
  session,
  target: organization(teamOrgId, 'team'),
  targetMember: {
    id: memberId,
    userId,
    organizationId: teamOrgId,
    role: 'member',
  },
};

// A selection write that always loses the optimistic-concurrency race:
// lexonSelectOrganization reports applied:false, so every attempt raises
// SelectionChanged and the bounded retry exhausts.
function racingIntegration(calls: { select: number }) {
  const tx = {
    call: (
      name: string,
      input?: { body?: { targetOrganizationId?: string } },
    ) => {
      if (name === 'lexonSecurityFacts') return Promise.resolve(securityFacts);
      if (name === 'lexonSelectionFacts')
        return Promise.resolve(
          input?.body?.targetOrganizationId ? targetFacts : currentFacts,
        );
      if (name === 'lexonSelectOrganization') {
        calls.select += 1;
        return Promise.resolve({ applied: false });
      }
      throw new Error(`Unexpected call ${name}`);
    },
  };
  const integration: AuthIntegration = {
    check: () => Promise.resolve('up'),
    transaction: <T>(work: (session: AuthCommandSession) => Promise<T>) =>
      work(tx as AuthCommandSession),
    handle: () => Promise.resolve(new Response()),
    close: () => Promise.resolve(),
  };
  return integration;
}

describe('IdentitySessionService selection race exhaustion', () => {
  test('a lost state race maps to ORG_STATE_CHANGED 409 after the bounded retry', async () => {
    const calls = { select: 0 };
    const service = new IdentitySessionService(racingIntegration(calls));
    const failure = await withVerifiedIdentity(
      {
        userId,
        sessionId,
        activeOrganizationId: personalOrgId,
        channel: 'cookie',
        platformAdmin: false,
        mfaVerifiedAt: null,
        reauthenticatedAt: null,
      },
      (identity) =>
        service.select(identity, teamOrgId).then(
          () => null,
          (error: unknown) => error,
        ),
      new Headers({ cookie: 'better-auth.session_token=test' }),
    );
    expect(failure).toBeInstanceOf(IdentityError);
    expect((failure as IdentityError).code).toBe('ORG_STATE_CHANGED');
    expect((failure as IdentityError).status).toBe(409);
    expect(calls.select).toBe(3);
  });
});
