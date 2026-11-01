import { expect, expectTypeOf, test } from 'vitest';
import {
  SignUpInputSchema,
  SignInInputSchema,
  ProfileInputSchema,
  SafeProfileSchema,
  IdentitySummarySchema,
  IdentityErrorCodeSchema,
  type IdentityApi,
} from '../src/index.js';

const signup = {
  name: '  A Person  ',
  email: ' Person@Example.test ',
  password: 'x'.repeat(12),
};
test('signup normalizes display name/email and requires twelve password characters', () => {
  expect(SignUpInputSchema.parse(signup)).toEqual({
    name: 'A Person',
    email: 'person@example.test',
    password: 'x'.repeat(12),
  });
  expect(
    SignUpInputSchema.safeParse({ ...signup, password: 'x'.repeat(11) })
      .success,
  ).toBe(false);
  expect(
    SignInInputSchema.safeParse({
      email: 'person@example.test',
      password: 'existing-password',
    }).success,
  ).toBe(true);
});
test('forms reject authority injection and invalid display names', () => {
  for (const extra of [
    { role: 'admin' },
    { kind: 'team' },
    { channel: 'bearer' },
    { admin: true },
  ])
    expect(SignUpInputSchema.safeParse({ ...signup, ...extra }).success).toBe(
      false,
    );
  for (const name of ['', ' ', 'x'.repeat(101)])
    expect(ProfileInputSchema.safeParse({ name }).success).toBe(false);
  expect(
    ProfileInputSchema.safeParse({
      name: 'A Person',
      email: 'other@example.test',
    }).success,
  ).toBe(false);
});
test('safe own profile is versioned and has no session credentials', () => {
  const profile = {
    version: 1,
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    email: 'person@example.test',
    name: 'A Person',
    emailVerified: true,
    twoFactorEnabled: false,
    onboardingCompleted: false,
  };
  expect(SafeProfileSchema.parse(profile)).toEqual(profile);
  expect(
    SafeProfileSchema.safeParse({ ...profile, token: 'secret' }).success,
  ).toBe(false);
  expect(SafeProfileSchema.safeParse({ ...profile, version: 2 }).success).toBe(
    false,
  );
  expect(
    IdentityErrorCodeSchema.safeParse('EMAIL_ALREADY_EXISTS').success,
  ).toBe(false);
  expect(IdentityErrorCodeSchema.parse('AUTH_REQUIRED')).toBe('AUTH_REQUIRED');
  expectTypeOf<
    'issueBearer' extends keyof IdentityApi ? true : false
  >().toEqualTypeOf<false>();
});
test('identity summary requires a boolean platform eligibility flag', () => {
  const summary = {
    version: 1 as const,
    platformAdmin: false,
    user: {
      version: 1 as const,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      email: 'person@example.test',
      name: 'A Person',
      emailVerified: true,
      twoFactorEnabled: false,
      onboardingCompleted: false,
    },
    organization: {
      version: 1 as const,
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      name: 'Personal',
      slug: 'personal-test',
      kind: 'personal' as const,
      state: 'active' as const,
      require2fa: false,
      role: 'owner' as const,
      createdAt: '2026-11-01T00:00:00.000Z',
    },
  };
  expect(IdentitySummarySchema.parse(summary).platformAdmin).toBe(false);
  expect(
    IdentitySummarySchema.safeParse(
      Object.fromEntries(
        Object.entries(summary).filter(([key]) => key !== 'platformAdmin'),
      ),
    ).success,
  ).toBe(false);
  expect(
    IdentitySummarySchema.safeParse({ ...summary, platformAdmin: 'true' })
      .success,
  ).toBe(false);
});
