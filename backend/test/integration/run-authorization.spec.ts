import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { identityApiHarness } from '../setup/identity-api-harness.js';
import { createOrganizationInspector } from '../../src/infrastructure/db/testing/organization-fixture.js';
import { createRunAuthorizationFixture } from '../setup/run-authorization-fixture.js';
import {
  AiRunRepository,
  RunActorFactsRepository,
  TenantDatabase,
} from '../../src/infrastructure/db/index.js';
import { currentVerifiedIdentity } from '../../src/modules/identity-access/identity.types.js';
import { RequestIdentity } from '../../src/modules/identity-access/request-identity.js';
import { RunAuthorizationService } from '../../src/modules/identity-access/run-authorization.service.js';

test('worker facts are tenant-bound and contain only authorization fields', async ({
  services,
}) => {
  const api = await identityApiHarness(services);
  const authorization = createRunAuthorizationFixture(services);
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  try {
    const user = await api.user('Authorization facts');
    const outsider = await api.user('Authorization outsider');
    const team = await organizations.seedTeam([user.profile.id]);
    const runId = await authorization.insertCompletedRun(
      team.id,
      user.profile.id,
    );
    const inspection = await authorization.inspectFacts(
      team.id,
      user.profile.id,
      outsider.profile.id,
    );
    expect(inspection.facts).toMatchObject([
      {
        email_verified: true,
        banned: false,
        two_factor_enabled: false,
        membership_role: 'owner',
        organization_kind: 'team',
        organization_state: 'active',
        require2fa: false,
      },
    ]);
    expect(Object.keys(inspection.facts[0]!)).not.toContain('password');
    expect(Object.keys(inspection.facts[0]!)).not.toContain('secret');
    expect(inspection.wrongUser).toEqual([]);
    expect(inspection.noContext).toEqual([]);
    expect(inspection.access).toEqual({
      app_execute: true,
      auth_execute: false,
      public_execute: false,
      password_read: false,
      user_update: false,
    });
    expect(inspection.definition).toBeDefined();
    expect(inspection.definition!).toMatchObject({
      prosecdef: true,
      proconfig: ['search_path=pg_catalog, auth, pg_temp'],
    });
    expect(inspection.definition!.definition).toContain(
      "current_setting('app.org_id', true)",
    );
    expect(inspection.definition!.definition).not.toContain('app.ai_runs');
    expect(runId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  } finally {
    await authorization.close();
    await organizations.close();
    await api.close();
  }
});

test('membership removal serializes after a worker-authorized effect', async ({
  services,
}) => {
  const api = await identityApiHarness(services);
  const authorization = createRunAuthorizationFixture(services);
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  try {
    const initiator = await api.user('Effect initiator');
    const removed = await api.user('Removed member');
    const team = await organizations.seedTeam([
      initiator.profile.id,
      removed.profile.id,
    ]);
    const runId = await authorization.insertCompletedRun(
      team.id,
      initiator.profile.id,
    );
    const effect = await authorization.authorizeEffectWhileRemovingMember(
      team.id,
      initiator.profile.id,
      removed.profile.id,
      runId,
    );
    expect(effect.facts).toHaveLength(1);
    expect(
      await authorization.runIterations(team.id, initiator.profile.id, runId),
    ).toBe(1);
  } finally {
    await authorization.close();
    await organizations.close();
    await api.close();
  }
});

test('selection and worker authorization share the F1 parent lock without deadlock', async ({
  services,
}) => {
  const api = await identityApiHarness(services);
  const authorization = createRunAuthorizationFixture(services);
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  try {
    const actor = await api.user('Selection authorization lock');
    const team = await organizations.seedTeam([actor.profile.id]);
    const result = await authorization.selectionAndAuthorization(
      team.id,
      actor.profile.id,
    );
    expect(result).toEqual({
      authorizationWaitedForUser: true,
      selectionCycle: false,
    });
  } finally {
    await authorization.close();
    await organizations.close();
    await api.close();
  }
});

test('same-user run authorizations overlap while the first authorized step is held', async ({
  services,
}) => {
  const api = await identityApiHarness(services);
  const authorization = createRunAuthorizationFixture(services);
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  try {
    const actor = await api.user('Concurrent run authorization');
    const team = await organizations.seedTeam([actor.profile.id]);
    const result = await authorization.sameUserAuthorizationsOverlap(
      team.id,
      actor.profile.id,
    );
    expect(result).toEqual({
      firstAuthorized: true,
      secondAuthorized: true,
      secondFinishedWhileFirstStepHeld: true,
    });
  } finally {
    await authorization.close();
    await organizations.close();
    await api.close();
  }
});

test('removing the authorized actor waits on the F1 parent pre-lock', async ({
  services,
}) => {
  const api = await identityApiHarness(services);
  const authorization = createRunAuthorizationFixture(services);
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  try {
    const initiator = await api.user('Self removal initiator');
    const remainingOwner = await api.user('Self removal remaining owner');
    const team = await organizations.seedTeam([
      initiator.profile.id,
      remainingOwner.profile.id,
    ]);
    const runId = await authorization.insertCompletedRun(
      team.id,
      initiator.profile.id,
    );
    const effect = await authorization.authorizeEffectWhileRemovingMember(
      team.id,
      initiator.profile.id,
      initiator.profile.id,
      runId,
    );
    expect(effect.facts).toHaveLength(1);
    expect(
      await authorization.runIterations(team.id, initiator.profile.id, runId),
    ).toBe(1);
  } finally {
    await authorization.close();
    await organizations.close();
    await api.close();
  }
});

test('a different active member cannot authorize a decision or mutate the run', async ({
  services,
}) => {
  const api = await identityApiHarness(services);
  const organizations = createOrganizationInspector({
    migratorUrl: services.migratorUrl,
  });
  const database = new TenantDatabase({
    appUrl: services.appUrl,
    poolMax: 4,
    statementTimeoutMs: 5000,
  });
  try {
    const initiator = await api.user('Decision initiator');
    const otherOwner = await api.user('Different owner');
    const team = await organizations.seedTeam([
      initiator.profile.id,
      otherOwner.profile.id,
    ]);
    const runs = new AiRunRepository();
    const run = await database.withTenant(
      { orgId: team.id, userId: initiator.profile.id },
      (tx) =>
        runs.insert(tx, {
          id: randomUUID(),
          orgId: team.id,
          initiatingUserId: initiator.profile.id,
          initiatingSessionId: randomUUID(),
          initiatingMfaVerifiedAt: null,
          profileId: 'test-profile',
          profileVersion: 1,
          resolvedConfig: {},
          modelId: 'test-model',
          inputText: 'test',
          inputBudgetTokens: 1,
          outputBudgetTokens: 1,
        }),
    );
    const factsRepository = new RunActorFactsRepository();
    const authorization = new RunAuthorizationService();
    const identities = new RequestIdentity();
    const request = {};
    const sessionId = randomUUID();
    identities.prepare(
      request,
      {
        identity: {
          userId: otherOwner.profile.id,
          sessionId,
          activeOrganizationId: team.id,
          channel: 'cookie',
          platformAdmin: false,
          mfaVerifiedAt: null,
          reauthenticatedAt: null,
        },
        tenant: {
          orgId: team.id,
          userId: otherOwner.profile.id,
          role: 'owner',
        },
        summary: {
          version: 1,
          platformAdmin: false,
          user: { ...otherOwner.profile, onboardingCompleted: false },
          organization: {
            version: 1,
            id: team.id,
            name: 'Authorization team',
            slug: 'authorization-team',
            state: 'active',
            createdAt: new Date().toISOString(),
            kind: 'team',
            require2fa: false,
            role: 'owner',
          },
        },
      },
      new Headers(),
    );

    const decision = await database.withTenant(
      { orgId: team.id, userId: otherOwner.profile.id },
      async (tx) => {
        const facts = await factsRepository.read(tx, {
          orgId: team.id,
          userId: otherOwner.profile.id,
          runId: run.id,
        });
        expect(facts).not.toBeNull();
        return identities.run(request, () =>
          authorization.withActor(currentVerifiedIdentity(), async () => {
            const authorized = await authorization.authorize(
              tx,
              facts!,
              { profileId: run.profileId, capabilities: ['documents:write'] },
              'decision',
            );
            if (authorized.allowed)
              await runs.transition(tx, {
                runId: run.id,
                expectedVersion: run.runVersion,
                from: 'queued',
                to: 'running',
              });
            return authorized;
          }),
        );
      },
    );

    expect(decision.mayDecide).toBe(false);
    expect(decision.allowed).toBe(false);
    const unchanged = await database.withTenant(
      { orgId: team.id, userId: initiator.profile.id },
      (tx) => runs.find(tx, run.id),
    );
    expect(unchanged?.status).toBe('queued');
  } finally {
    await database.close();
    await organizations.close();
    await api.close();
  }
});
