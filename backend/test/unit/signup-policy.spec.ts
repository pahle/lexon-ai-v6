import { expect, test } from 'vitest';
import { SignupPolicy } from '../../src/modules/identity-access/signup-policy.js';

const future = '2030-01-01T00:00:00.000Z';
const past = '2020-01-01T00:00:00.000Z';
const email = 'person@example.test';
const invitationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('open registration is a domain decision and never assigns organization or admin rights', async () => {
  const policy = new SignupPolicy({
    openSignup: true,
    readFacts: async () => ({ invitation: null, setup: null }),
  });
  await expect(policy.authorize({ email })).resolves.toBeUndefined();
});
test('invitation-only registration needs a current matching invitation', async () => {
  for (const invitation of [
    null,
    {
      email,
      status: 'pending',
      expiresAt: past,
      purpose: 'team',
      organizationState: 'active',
    },
    {
      email: 'other@example.test',
      status: 'pending',
      expiresAt: future,
      purpose: 'team',
      organizationState: 'active',
    },
    {
      email,
      status: 'accepted',
      expiresAt: future,
      purpose: 'team',
      organizationState: 'active',
    },
  ]) {
    const policy = new SignupPolicy({
      openSignup: false,
      readFacts: async () => ({ invitation, setup: null }),
    });
    await expect(
      policy.authorize({ email, invitationId }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  }
  const policy = new SignupPolicy({
    openSignup: false,
    readFacts: async () => ({
      invitation: {
        email,
        status: 'pending',
        expiresAt: future,
        purpose: 'first_owner',
        organizationState: 'provisioning',
      },
      setup: null,
    }),
  });
  await expect(
    policy.authorize({ email: ' Person@Example.test ', invitationId }),
  ).resolves.toBeUndefined();
});
test('setup eligibility uses a digest, matching email and pending unexpired state only', async () => {
  let digest: string | undefined;
  const policy = new SignupPolicy({
    openSignup: false,
    readFacts: async (input) => {
      digest = input.setupDigest;
      return {
        invitation: null,
        setup: {
          expiresAt: future,
          value: JSON.stringify({
            version: 1,
            email,
            status: 'pending',
            additional: false,
            boundUserId: null,
          }),
        },
      };
    },
  });
  await expect(
    policy.authorize({ email, setupToken: 'opaque-test-token' }),
  ).resolves.toBeUndefined();
  expect(digest).toMatch(/^[a-f0-9]{64}$/);
  expect(digest?.includes('opaque-test-token')).toBe(false);
  for (const state of ['consumed', 'cancelled']) {
    const blocked = new SignupPolicy({
      openSignup: false,
      readFacts: async () => ({
        invitation: null,
        setup: {
          expiresAt: future,
          value: JSON.stringify({
            version: 1,
            email,
            status: state,
            additional: false,
            boundUserId: null,
          }),
        },
      }),
    });
    await expect(
      blocked.authorize({ email, setupToken: 'opaque-test-token' }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  }
});
