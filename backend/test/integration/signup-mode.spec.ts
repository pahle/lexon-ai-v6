import { randomUUID, createHash } from 'node:crypto';
import { createAccountInspector } from '../../src/infrastructure/db/testing/account-fixture.js';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { SignupPolicy } from '../../src/modules/identity-access/signup-policy.js';
import { AccountService } from '../../src/modules/identity-access/account.service.js';

test('email-bound invitation admits signup without granting team membership', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const inspect = createAccountInspector(services);
  try {
    const owner = await proof.signIn({
      body: {
        email: `${randomUUID()}@example.test`,
        name: 'Team owner',
        password: 'Owner-password-42!',
      },
    });
    const organization = await proof.integration.transaction((tx) =>
      tx.call('createOrganization', {
        body: {
          name: 'Inviting team',
          slug: `team-${randomUUID()}`,
          userId: owner.userId,
        },
      }),
    );
    const invitationId = randomUUID();
    const email = `${randomUUID()}@example.test`;
    await inspect.seedPendingInvitation({
      id: invitationId,
      organizationId: organization!.id,
      email,
      inviterId: owner.userId,
    });
    const account = new AccountService(proof.integration, {
      openSignup: false,
    });
    await expect(
      account.signUp({
        email: `other-${email}`,
        name: 'Recipient',
        password: 'Recipient-password-42!',
        invitationId,
      }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(
      await account.signUp({
        email,
        name: 'Recipient',
        password: 'Recipient-password-42!',
        invitationId,
      }),
    ).toEqual({ status: true });
    const facts = await proof.integration.transaction((tx) =>
      tx.call('lexonAccountOperationFacts', { body: { email } }),
    );
    expect(facts.userId).not.toBeNull();
    expect(await inspect.membershipCount(facts.userId!)).toBe(1);
    expect(await proof.inspect.personalFor(facts.userId!)).toMatchObject({
      role: 'owner',
    });
  } finally {
    await inspect.close();
    await proof.close();
  }
});

test('the selected account facade applies signup policy and returns a fixed envelope', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  try {
    const email = `${randomUUID()}@example.test`;
    const body = {
      email: ` ${email.toUpperCase()} `,
      name: 'New user',
      password: 'Account-password-42!',
    };
    const closed = new AccountService(proof.integration, { openSignup: false });
    await expect(closed.signUp(body)).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });
    expect(await proof.inspect.countUsers(email)).toBe(0);
    const open = new AccountService(proof.integration, { openSignup: true });
    expect(await open.signUp(body)).toEqual({ status: true });
    expect(await open.signUp(body)).toEqual({ status: true });
    expect(await proof.inspect.countUsers(email)).toBe(1);
  } finally {
    await proof.close();
  }
});

test('invitation-only policy reads locked native setup facts in the account transaction', async ({
  services,
}) => {
  const proof = await createAuthFixture(services);
  const migrator = createAccountInspector(services);
  try {
    const email = `${randomUUID()}@example.test`;
    const setupToken = randomUUID();
    const identifier = `lexon.admin-setup.v1:${createHash('sha256').update(setupToken).digest('hex')}`;
    await migrator.seedSetupGrant(
      identifier,
      JSON.stringify({
        version: 1,
        email,
        status: 'pending',
        additional: false,
        boundUserId: null,
      }),
    );
    const register = (token?: string) =>
      proof.integration.transaction(async (tx) => {
        const policy = new SignupPolicy({
          openSignup: false,
          readFacts: (body) => tx.call('lexonSignupEligibility', { body }),
        });
        await policy.authorize({
          email,
          ...(token ? { setupToken: token } : {}),
        });
        return tx.call('signUpEmail', {
          body: {
            email,
            name: 'Pending operator',
            password: 'Pending-password-42!',
          },
        });
      });
    await expect(register()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(await proof.inspect.countUsers(email)).toBe(0);
    const created = await register(setupToken);
    expect(created.user.role).toBe('user');
    expect(await proof.inspect.personalFor(created.user.id)).toMatchObject({
      role: 'owner',
      memberCount: 1,
    });
    expect(await migrator.membershipCount(created.user.id)).toBe(1);
  } finally {
    await migrator.close();
    await proof.close();
  }
});
