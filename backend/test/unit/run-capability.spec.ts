import { describe, expect, test } from 'vitest';
import { decideRunCapabilities } from '../../src/modules/identity-access/run-capability-policy.js';
import { RunAuthorizationService } from '../../src/modules/identity-access/run-authorization.service.js';
import { RequestIdentity } from '../../src/modules/identity-access/request-identity.js';
import { currentVerifiedIdentity } from '../../src/modules/identity-access/identity.types.js';

const baseFacts = {
  phase: 'decision' as const,
  actorUserId: '10000000-0000-4000-8000-000000000001',
  initiatingUserId: '10000000-0000-4000-8000-000000000001',
  emailVerified: true,
  banned: false,
  twoFactorEnabled: false,
  mfaVerifiedAt: null,
  membershipRole: 'owner' as const,
  organizationKind: 'team' as const,
  organizationState: 'active' as const,
  require2fa: false,
  profileId: 'workspace-chat',
  capabilities: ['chat:read', 'documents:write'],
};

describe('decideRunCapabilities', () => {
  test('removes all capability when current membership is lost', () => {
    const decision = decideRunCapabilities({
      ...baseFacts,
      phase: 'tool',
      membershipRole: null,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.capabilities).toEqual([]);
  });

  test('denies banned users and organizations still provisioning', () => {
    expect(decideRunCapabilities({ ...baseFacts, banned: true }).allowed).toBe(
      false,
    );
    expect(
      decideRunCapabilities({
        ...baseFacts,
        organizationState: 'provisioning',
      }).allowed,
    ).toBe(false);
  });

  test('does not let a role approve for another initiator', () => {
    const otherInitiatorFacts = {
      ...baseFacts,
      actorUserId: '10000000-0000-4000-8000-000000000002',
    };

    const decision = decideRunCapabilities(otherInitiatorFacts);
    let executedUnapprovedWrites = 0;
    if (decision.allowed) executedUnapprovedWrites += 1;

    expect(decision.mayDecide).toBe(false);
    expect(executedUnapprovedWrites).toBe(0);
  });

  test('requires trusted MFA evidence when the organization requires it', () => {
    const insufficientEvidence = decideRunCapabilities({
      ...baseFacts,
      require2fa: true,
    });

    expect(insufficientEvidence.allowed).toBe(false);
    expect(
      decideRunCapabilities({
        ...baseFacts,
        require2fa: true,
        mfaVerifiedAt: new Date('2026-11-05T08:00:00.000Z'),
      }).allowed,
    ).toBe(true);
  });

  test('does not expose capabilities outside the supplied profile policy', () => {
    const decision = decideRunCapabilities({
      ...baseFacts,
      phase: 'tool',
      capabilities: ['chat:read'],
    });

    expect(decision.capabilities).toEqual(['chat:read']);
  });
});

describe('RunAuthorizationService.withActor', () => {
  const service = new RunAuthorizationService();

  test('requires the active verified identity scope and prevents actor reuse', async () => {
    const request = {};
    const identities = new RequestIdentity();
    identities.prepare(
      request,
      {
        identity: {
          userId: baseFacts.actorUserId,
          sessionId: '20000000-0000-4000-8000-000000000001',
          activeOrganizationId: '30000000-0000-4000-8000-000000000001',
          channel: 'cookie',
          platformAdmin: false,
          mfaVerifiedAt: new Date('2026-11-05T08:00:00.000Z'),
          reauthenticatedAt: null,
        },
        tenant: {
          orgId: '30000000-0000-4000-8000-000000000001',
          userId: baseFacts.actorUserId,
          role: 'owner',
        },
        summary: {
          version: 1,
          user: {
            version: 1,
            id: baseFacts.actorUserId,
            name: 'Run initiator',
            email: 'initiator@example.test',
            emailVerified: true,
            twoFactorEnabled: true,
            onboardingCompleted: false,
          },
          organization: {
            version: 1,
            id: '30000000-0000-4000-8000-000000000001',
            name: 'Run team',
            slug: 'run-team',
            kind: 'team',
            state: 'active',
            require2fa: true,
            role: 'owner',
            createdAt: '2026-11-05T08:00:00.000Z',
          },
          platformAdmin: false,
        },
      },
      new Headers(),
    );

    let escapedActor: { sessionId: string } | undefined;
    await identities.run(request, async () => {
      await service.withActor(currentVerifiedIdentity(), async (actor) => {
        escapedActor = actor;
        expect(actor.sessionId).toBe('20000000-0000-4000-8000-000000000001');
        expect(actor.mfaVerifiedAt?.toISOString()).toBe(
          '2026-11-05T08:00:00.000Z',
        );
        actor.mfaVerifiedAt?.setTime(0);
        expect(actor.mfaVerifiedAt?.toISOString()).toBe(
          '2026-11-05T08:00:00.000Z',
        );
      });
    });

    expect(() => escapedActor!.sessionId).toThrow();
    expect(() =>
      service.withActor(
        {
          userId: baseFacts.actorUserId,
          sessionId: '20000000-0000-4000-8000-000000000001',
          activeOrganizationId: '30000000-0000-4000-8000-000000000001',
          channel: 'cookie',
          platformAdmin: false,
          mfaVerifiedAt: null,
          reauthenticatedAt: null,
        } as never,
        async () => undefined,
      ),
    ).toThrow();
  });
});
