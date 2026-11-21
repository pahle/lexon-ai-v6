import { expect, test } from 'vitest';
import {
  AccountInvitationSchema,
  AccountInvitationsPageSchema,
  IdentityErrorCodeSchema,
  PlatformAccountDetailSchema,
  PlatformAccountSummarySchema,
  PlatformAccountsPageSchema,
  PlatformMemberSchema,
  PlatformMembersPageSchema,
  PlatformOrganizationDetailSchema,
  PlatformOrganizationSummarySchema,
  PlatformOrganizationsPageSchema,
  PlatformSearchSchema,
  SignUpInputSchema,
} from '../src/index.js';

const id = '3f1c2a52-6a39-4c3f-8c4e-2d4f6a1b9e01';
const at = '2026-11-21T10:00:00.000Z';
const summary = {
  id,
  name: 'A',
  email: 'a@example.test',
  status: 'active',
  twoFactorEnabled: true,
  isPlatformAdministrator: false,
  teamCount: 1,
  createdAt: at,
  lastActiveAt: null,
};
const team = {
  organizationId: id,
  name: 'Team',
  slug: 'team-one',
  role: 'owner',
};
const detail = {
  ...summary,
  emailVerified: true,
  activeSessionCount: 2,
  teams: [team],
};
const invitation = {
  id,
  email: 'a@example.test',
  name: null,
  status: 'pending',
  invitedBy: 'Admin',
  sentAt: at,
  expiresAt: at,
};
const orgSummary = {
  id,
  name: 'Team',
  slug: 'team-one',
  state: 'active',
  memberCount: 3,
  ownerEmail: 'o@example.test',
  createdAt: at,
};
const orgActive = { ...orgSummary, requireTwoFactor: true };
const orgProvisioning = {
  version: 1,
  id,
  name: 'Team',
  slug: 'team-one',
  kind: 'team',
  state: 'provisioning',
  createdAt: at,
  invitation: { id, status: 'pending', expiresAt: at },
  memberCount: 0,
  ownerEmail: 'o@example.test',
};
const member = {
  userId: id,
  name: 'M',
  email: 'm@example.test',
  role: 'member',
  joinedAt: at,
};
const page = (item: unknown) => ({
  items: [item],
  page: 1,
  pageSize: 20,
  total: 1,
});

const cases = [
  ['account summary', PlatformAccountSummarySchema, summary],
  ['account detail', PlatformAccountDetailSchema, detail],
  ['accounts page', PlatformAccountsPageSchema, page(summary)],
  ['invitation', AccountInvitationSchema, invitation],
  ['invitations page', AccountInvitationsPageSchema, page(invitation)],
  ['organization summary', PlatformOrganizationSummarySchema, orgSummary],
  ['organizations page', PlatformOrganizationsPageSchema, page(orgSummary)],
  ['organization detail active', PlatformOrganizationDetailSchema, orgActive],
  [
    'organization detail provisioning',
    PlatformOrganizationDetailSchema,
    orgProvisioning,
  ],
  ['member', PlatformMemberSchema, member],
  ['members page', PlatformMembersPageSchema, page(member)],
] as const;

test.each(cases)(
  '%s parses and rejects an extra key',
  (_n, schema, fixture) => {
    expect(schema.safeParse(fixture).success).toBe(true);
    expect(schema.safeParse({ ...fixture, extra: 1 }).success).toBe(false);
  },
);
test('search trims and bounds', () => {
  expect(PlatformSearchSchema.parse('  ab ')).toBe('ab');
  expect(PlatformSearchSchema.safeParse('a').success).toBe(false);
  expect(PlatformSearchSchema.safeParse('x'.repeat(101)).success).toBe(false);
});
test('active organization detail requires requireTwoFactor', () => {
  expect(PlatformOrganizationDetailSchema.safeParse(orgSummary).success).toBe(
    false,
  );
});
test('sign up accepts an account invitation token', () => {
  expect(
    SignUpInputSchema.safeParse({
      name: 'A Person',
      email: 'p@example.test',
      password: 'x'.repeat(12),
      accountInvitationToken: 'tok',
    }).success,
  ).toBe(true);
});
test('safe error list has the platform codes', () => {
  for (const code of [
    'PLATFORM_SELF_ACTION',
    'PLATFORM_LAST_ADMINISTRATOR',
    'PLATFORM_ALREADY_VERIFIED',
    'PLATFORM_INVITATION_CONFLICT',
    'NOT_FOUND',
  ]) {
    expect(IdentityErrorCodeSchema.safeParse(code).success).toBe(true);
  }
});
