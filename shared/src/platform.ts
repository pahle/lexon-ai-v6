import { z } from 'zod';
import {
  UuidSchema,
  DisplayNameSchema,
  EmailAddressSchema,
} from './identity.js';
import {
  OrgRoleSchema,
  ProvisioningSummarySchema,
  TeamSlugSchema,
} from './organizations.js';
import {
  NumberedPageQuerySchema,
  facetSchema,
  numberedPageSchema,
} from './numbered-page.js';

export const PlatformSearchSchema = z.string().trim().min(2).max(100);
export const PlatformAccountStatusSchema = z.enum([
  'active',
  'unverified',
  'disabled',
]);
export const PlatformAccountsQuerySchema = NumberedPageQuerySchema.extend({
  query: PlatformSearchSchema.optional(),
  status: facetSchema(PlatformAccountStatusSchema),
  twoFactor: facetSchema(z.enum(['on', 'off'])),
});
export const PlatformAccountSummarySchema = z.strictObject({
  id: UuidSchema,
  name: z.string(),
  email: z.string(),
  status: PlatformAccountStatusSchema,
  twoFactorEnabled: z.boolean(),
  isPlatformAdministrator: z.boolean(), // owner-approved addition, 2026-11-21
  teamCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  lastActiveAt: z.iso.datetime().nullable(),
});
export const PlatformAccountsPageSchema = numberedPageSchema(
  PlatformAccountSummarySchema,
);
export const PlatformAccountTeamSchema = z.strictObject({
  organizationId: UuidSchema,
  name: DisplayNameSchema,
  slug: TeamSlugSchema,
  role: OrgRoleSchema,
});
export const PlatformAccountDetailSchema = PlatformAccountSummarySchema.extend({
  emailVerified: z.boolean(),
  activeSessionCount: z.number().int().nonnegative(),
  teams: z.array(PlatformAccountTeamSchema),
});

export const AccountInvitationStatusSchema = z.enum(['pending', 'expired']);
export const AccountInvitationsQuerySchema = NumberedPageQuerySchema.extend({
  query: PlatformSearchSchema.optional(),
  status: facetSchema(AccountInvitationStatusSchema),
});
export const AccountInvitationSchema = z.strictObject({
  id: UuidSchema,
  email: z.string(),
  name: z.string().nullable(),
  status: AccountInvitationStatusSchema,
  invitedBy: z.string(), // the inviting administrator's name
  sentAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export const AccountInvitationsPageSchema = numberedPageSchema(
  AccountInvitationSchema,
);
export const AccountInvitationInputSchema = z.strictObject({
  email: EmailAddressSchema,
  name: DisplayNameSchema.optional(),
});

export const PlatformOrganizationStateSchema = z.enum([
  'active',
  'provisioning',
]);
export const PlatformOrganizationsQuerySchema = NumberedPageQuerySchema.extend({
  query: PlatformSearchSchema.optional(),
  state: facetSchema(PlatformOrganizationStateSchema),
});
export const PlatformOrganizationSummarySchema = z.strictObject({
  id: UuidSchema,
  name: DisplayNameSchema,
  slug: TeamSlugSchema,
  state: PlatformOrganizationStateSchema,
  memberCount: z.number().int().nonnegative(),
  ownerEmail: z.string(),
  createdAt: z.iso.datetime(),
});
export const PlatformOrganizationsPageSchema = numberedPageSchema(
  PlatformOrganizationSummarySchema,
);
export const PlatformOrganizationDetailSchema = z.discriminatedUnion('state', [
  PlatformOrganizationSummarySchema.extend({
    state: z.literal('active'),
    requireTwoFactor: z.boolean(),
  }),
  ProvisioningSummarySchema.extend({
    memberCount: z.number().int().nonnegative(),
    ownerEmail: z.string(),
  }),
]);
export const PlatformMemberSchema = z.strictObject({
  userId: UuidSchema,
  name: z.string(),
  email: z.string(),
  role: OrgRoleSchema,
  joinedAt: z.iso.datetime(),
});
export const PlatformMembersPageSchema =
  numberedPageSchema(PlatformMemberSchema);

export type PlatformAccountStatus = z.infer<typeof PlatformAccountStatusSchema>;
export type PlatformAccountsQuery = z.infer<typeof PlatformAccountsQuerySchema>;
export type PlatformAccountSummary = z.infer<
  typeof PlatformAccountSummarySchema
>;
export type PlatformAccountsPage = z.infer<typeof PlatformAccountsPageSchema>;
export type PlatformAccountTeam = z.infer<typeof PlatformAccountTeamSchema>;
export type PlatformAccountDetail = z.infer<typeof PlatformAccountDetailSchema>;
export type AccountInvitationStatus = z.infer<
  typeof AccountInvitationStatusSchema
>;
export type AccountInvitationsQuery = z.infer<
  typeof AccountInvitationsQuerySchema
>;
export type AccountInvitation = z.infer<typeof AccountInvitationSchema>;
export type AccountInvitationsPage = z.infer<
  typeof AccountInvitationsPageSchema
>;
export type AccountInvitationInput = z.infer<
  typeof AccountInvitationInputSchema
>;
export type PlatformOrganizationState = z.infer<
  typeof PlatformOrganizationStateSchema
>;
export type PlatformOrganizationsQuery = z.infer<
  typeof PlatformOrganizationsQuerySchema
>;
export type PlatformOrganizationSummary = z.infer<
  typeof PlatformOrganizationSummarySchema
>;
export type PlatformOrganizationsPage = z.infer<
  typeof PlatformOrganizationsPageSchema
>;
export type PlatformOrganizationDetail = z.infer<
  typeof PlatformOrganizationDetailSchema
>;
export type PlatformMember = z.infer<typeof PlatformMemberSchema>;
export type PlatformMembersPage = z.infer<typeof PlatformMembersPageSchema>;
export type PlatformErrorCode =
  | 'PLATFORM_SELF_ACTION'
  | 'PLATFORM_LAST_ADMINISTRATOR'
  | 'PLATFORM_ALREADY_VERIFIED'
  | 'PLATFORM_INVITATION_CONFLICT';
