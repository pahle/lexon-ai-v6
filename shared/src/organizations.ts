import { z } from 'zod';
import {
  UuidSchema,
  DisplayNameSchema,
  EmailAddressSchema,
} from './identity.js';

export const OrgRoleSchema = z.enum(['owner', 'admin', 'member']);
export const OrgKindSchema = z.enum(['personal', 'team']);
export const OrgActionSchema = z.enum([
  'create_team',
  'read_members',
  'read_invitations',
  'invite_member',
  'invite_admin',
  'promote_owner',
  'change_role',
  'remove_member',
  'leave',
  'settings',
]);
export type OrgRole = z.infer<typeof OrgRoleSchema>;
export type OrgKind = z.infer<typeof OrgKindSchema>;
export type OrgAction = z.infer<typeof OrgActionSchema>;
export const TeamSlugSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Use lowercase letters, digits and single internal hyphens.',
  );
export const CreateOrganizationInputSchema = z.strictObject({
  name: DisplayNameSchema,
  slug: TeamSlugSchema,
});
export type CreateOrganizationInput = z.infer<
  typeof CreateOrganizationInputSchema
>;
const organization = {
  version: z.literal(1),
  id: UuidSchema,
  name: DisplayNameSchema,
  slug: TeamSlugSchema,
  state: z.literal('active'),
  createdAt: z.iso.datetime(),
};
export const OrganizationSummarySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...organization,
    kind: z.literal('personal'),
    require2fa: z.literal(false),
    role: z.literal('owner'),
  }),
  z.strictObject({
    ...organization,
    kind: z.literal('team'),
    require2fa: z.boolean(),
    role: OrgRoleSchema,
  }),
]);
export type OrganizationSummary = z.infer<typeof OrganizationSummarySchema>;
export const MemberSummarySchema = z.strictObject({
  version: z.literal(1),
  id: UuidSchema,
  userId: UuidSchema,
  organizationId: UuidSchema,
  name: DisplayNameSchema,
  email: EmailAddressSchema,
  role: OrgRoleSchema,
  createdAt: z.iso.datetime(),
});
export type MemberSummary = z.infer<typeof MemberSummarySchema>;
export const InvitationStatusSchema = z.enum([
  'pending',
  'accepted',
  'declined',
  'cancelled',
  'expired',
]);
export type InvitationStatus = z.infer<typeof InvitationStatusSchema>;
export const InvitationInputSchema = z.strictObject({
  email: EmailAddressSchema,
  role: z.enum(['member', 'admin']),
});
export type InvitationInput = z.infer<typeof InvitationInputSchema>;
export const InvitationSummarySchema = z.strictObject({
  version: z.literal(1),
  id: UuidSchema,
  organizationId: UuidSchema,
  organizationName: DisplayNameSchema,
  email: EmailAddressSchema,
  role: OrgRoleSchema,
  purpose: z.enum(['team', 'first_owner']),
  status: InvitationStatusSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type InvitationSummary = z.infer<typeof InvitationSummarySchema>;
export const SwitchResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('switched'),
    organization: OrganizationSummarySchema,
  }),
  z.strictObject({
    status: z.literal('enrollment_required'),
    organization: OrganizationSummarySchema,
    pendingOrganizationId: UuidSchema,
  }),
]);
export type SwitchResult = z.infer<typeof SwitchResultSchema>;
export const InvitationAcceptanceSchema = z.strictObject({
  invitation: InvitationSummarySchema,
  selection: SwitchResultSchema,
});
export type InvitationAcceptance = z.infer<typeof InvitationAcceptanceSchema>;
export const OrganizationSettingsInputSchema = z
  .strictObject({
    name: DisplayNameSchema.optional(),
    slug: TeamSlugSchema.optional(),
    require2fa: z.boolean().optional(),
  })
  .refine(
    (input) =>
      input.name !== undefined ||
      input.slug !== undefined ||
      input.require2fa !== undefined,
    { message: 'Choose a setting to update.' },
  );
export type OrganizationSettingsInput = z.infer<
  typeof OrganizationSettingsInputSchema
>;
export const ProvisioningInputSchema = CreateOrganizationInputSchema.extend({
  ownerEmail: EmailAddressSchema,
});
export type ProvisioningInput = z.infer<typeof ProvisioningInputSchema>;
export const ProvisioningSummarySchema = z.strictObject({
  version: z.literal(1),
  id: UuidSchema,
  name: DisplayNameSchema,
  slug: TeamSlugSchema,
  kind: z.literal('team'),
  state: z.literal('provisioning'),
  createdAt: z.iso.datetime(),
  invitation: z.strictObject({
    id: UuidSchema,
    status: InvitationStatusSchema,
    expiresAt: z.iso.datetime(),
  }),
});
export type ProvisioningSummary = z.infer<typeof ProvisioningSummarySchema>;
