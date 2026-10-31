import { expect, test } from 'vitest';
import {
  CreateOrganizationInputSchema,
  OrganizationSummarySchema,
  InvitationInputSchema,
  InvitationSummarySchema,
  ProvisioningSummarySchema,
  SwitchResultSchema,
  PaginationSchema,
  OrganizationSettingsInputSchema,
} from '../src/index.js';

const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const organization = {
  version: 1,
  id,
  name: 'Team',
  slug: 'legal-team',
  kind: 'team',
  state: 'active',
  require2fa: false,
  role: 'owner',
  createdAt: '2026-11-01T00:00:00.000Z',
};
test('team forms constrain names/slugs and exclude server-owned state and owner invites', () => {
  expect(
    CreateOrganizationInputSchema.parse({ name: ' Team ', slug: 'legal-team' }),
  ).toEqual({ name: 'Team', slug: 'legal-team' });
  for (const slug of [
    'ab',
    '-legal',
    'legal-',
    'legal--team',
    'Legal',
    'legal_team',
    'x'.repeat(64),
  ])
    expect(
      CreateOrganizationInputSchema.safeParse({ name: 'Team', slug }).success,
    ).toBe(false);
  expect(
    CreateOrganizationInputSchema.safeParse({
      name: 'Team',
      slug: 'legal-team',
      kind: 'personal',
    }).success,
  ).toBe(false);
  expect(
    InvitationInputSchema.safeParse({
      email: 'person@example.test',
      role: 'owner',
    }).success,
  ).toBe(false);
  expect(
    InvitationInputSchema.safeParse({
      email: 'person@example.test',
      role: 'admin',
    }).success,
  ).toBe(true);
});
test('switchable summaries exclude provisioning and unknown roles', () => {
  expect(OrganizationSummarySchema.parse(organization)).toEqual(organization);
  expect(
    OrganizationSummarySchema.safeParse({
      ...organization,
      kind: 'personal',
      name: 'Personal',
    }).success,
  ).toBe(true);
  for (const value of [
    { ...organization, state: 'provisioning' },
    { ...organization, id: 'bad' },
    { ...organization, role: 'superuser' },
  ])
    expect(OrganizationSummarySchema.safeParse(value).success).toBe(false);
  expect(
    SwitchResultSchema.safeParse({
      status: 'enrollment_required',
      organization,
      pendingOrganizationId: id,
    }).success,
  ).toBe(true);
});
test('public invitation statuses use declined/cancelled and derive expiry in backend', () => {
  const invitation = {
    version: 1,
    id,
    organizationId: id,
    organizationName: 'Team',
    email: 'person@example.test',
    role: 'member',
    purpose: 'team',
    status: 'pending',
    createdAt: '2026-11-01T00:00:00.000Z',
    expiresAt: '2026-11-15T00:00:00.000Z',
  };
  for (const status of [
    'pending',
    'accepted',
    'declined',
    'cancelled',
    'expired',
  ])
    expect(
      InvitationSummarySchema.safeParse({ ...invitation, status }).success,
    ).toBe(true);
  for (const status of ['rejected', 'canceled', 'unknown'])
    expect(
      InvitationSummarySchema.safeParse({ ...invitation, status }).success,
    ).toBe(false);
});
test('provisioning exposes metadata/status only and pagination keeps foundation bounds', () => {
  const provisioning = {
    version: 1,
    id,
    name: 'Team',
    slug: 'legal-team',
    kind: 'team',
    state: 'provisioning',
    createdAt: '2026-11-01T00:00:00.000Z',
    invitation: {
      id,
      status: 'pending',
      expiresAt: '2026-11-15T00:00:00.000Z',
    },
  };
  expect(ProvisioningSummarySchema.parse(provisioning)).toEqual(provisioning);
  expect(
    ProvisioningSummarySchema.safeParse({ ...provisioning, members: [] })
      .success,
  ).toBe(false);
  expect(
    ProvisioningSummarySchema.safeParse({ ...provisioning, state: 'active' })
      .success,
  ).toBe(false);
  expect(PaginationSchema.parse({})).toEqual({ limit: 20 });
  expect(PaginationSchema.safeParse({ limit: 101 }).success).toBe(false);
});

test('settings accept explicit false and forbid empty or owner-field mutation', () => {
  expect(OrganizationSettingsInputSchema.parse({ require2fa: false })).toEqual({
    require2fa: false,
  });
  for (const input of [
    {},
    { require2fa: 'false' },
    { kind: 'personal' },
    { ownerId: id },
  ])
    expect(OrganizationSettingsInputSchema.safeParse(input).success).toBe(
      false,
    );
});
