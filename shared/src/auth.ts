import { z } from 'zod';
import {
  UuidSchema,
  DisplayNameSchema,
  EmailAddressSchema,
  type Uuid,
} from './identity.js';
import { ErrorResponseSchema } from './error.js';
import type { Page, Pagination } from './pagination.js';
import {
  OrganizationSummarySchema,
  type CreateOrganizationInput,
  type OrganizationSummary,
  type MemberSummary,
  type InvitationSummary,
  type InvitationInput,
  type InvitationAcceptance,
  type SwitchResult,
  type OrganizationSettingsInput,
  type OrgRole,
  type ProvisioningSummary,
  type ProvisioningInput,
} from './organizations.js';
import {
  NewPasswordSchema,
  ExistingPasswordSchema,
  FlowTokenSchema,
  type OwnSessionSummary,
  type SecurityState,
  type ReauthenticateInput,
} from './security.js';

export const SignUpInputSchema = z.strictObject({
  name: DisplayNameSchema,
  email: EmailAddressSchema,
  password: NewPasswordSchema,
  invitationId: UuidSchema.optional(),
  setupToken: FlowTokenSchema.optional(),
});
export type SignUpInput = z.infer<typeof SignUpInputSchema>;
export const SignInInputSchema = z.strictObject({
  email: EmailAddressSchema,
  password: ExistingPasswordSchema,
});
export type SignInInput = z.infer<typeof SignInInputSchema>;
export const ProfileInputSchema = z.strictObject({ name: DisplayNameSchema });
export type ProfileInput = z.infer<typeof ProfileInputSchema>;
export const SafeProfileSchema = z.strictObject({
  version: z.literal(1),
  id: UuidSchema,
  email: EmailAddressSchema,
  name: DisplayNameSchema,
  emailVerified: z.boolean(),
  twoFactorEnabled: z.boolean(),
  onboardingCompleted: z.boolean(),
});
export type SafeProfile = z.infer<typeof SafeProfileSchema>;
export const IdentitySummarySchema = z.strictObject({
  version: z.literal(1),
  user: SafeProfileSchema,
  organization: OrganizationSummarySchema,
  fallbackReason: z
    .enum(['membership_removed', 'selection_repaired'])
    .optional(),
  previousOrganizationName: DisplayNameSchema.optional(),
});
export type IdentitySummary = z.infer<typeof IdentitySummarySchema>;
export const IdentityErrorCodeSchema = z.enum([
  'AUTH_REQUIRED',
  'AUTH_EMAIL_VERIFICATION_REQUIRED',
  'AUTH_2FA_REQUIRED',
  'AUTH_REAUTH_REQUIRED',
  'AUTH_DISABLED',
  'AUTH_RATE_LIMITED',
  'AUTH_UNAVAILABLE',
  'ORG_MEMBERSHIP_REQUIRED',
  'ORG_LAST_OWNER',
  'ORG_FORBIDDEN',
  'INVITATION_UNAVAILABLE',
  'VALIDATION_ERROR',
]);
export type IdentityErrorCode = z.infer<typeof IdentityErrorCodeSchema>;
export const IdentityErrorResponseSchema = ErrorResponseSchema.extend({
  error: ErrorResponseSchema.shape.error.extend({
    code: IdentityErrorCodeSchema,
  }),
});
export type IdentityErrorResponse = z.infer<typeof IdentityErrorResponseSchema>;

// Route nouns/methods follow the approved Lexon API. Credential auth uses the
// allowlisted Better Auth client; organization operations always use this API.
export interface IdentityApi {
  identity(): Promise<IdentitySummary>;
  profile(): Promise<SafeProfile>;
  updateProfile(input: ProfileInput): Promise<SafeProfile>;
  completeOnboarding(): Promise<void>;
  security(): Promise<SecurityState>;
  reauthenticate(input: ReauthenticateInput): Promise<void>;
  listSessions(): Promise<OwnSessionSummary[]>;
  revokeSession(sessionId: Uuid): Promise<void>;
  listOrganizations(page?: Pagination): Promise<Page<OrganizationSummary>>;
  createOrganization(
    input: CreateOrganizationInput,
  ): Promise<OrganizationSummary>;
  switchOrganization(organizationId: Uuid): Promise<SwitchResult>;
  updateOrganization(
    organizationId: Uuid,
    input: OrganizationSettingsInput,
  ): Promise<OrganizationSummary>;
  listMembers(
    organizationId: Uuid,
    page?: Pagination,
  ): Promise<Page<MemberSummary>>;
  changeMemberRole(
    organizationId: Uuid,
    memberId: Uuid,
    role: OrgRole,
  ): Promise<MemberSummary>;
  removeMember(organizationId: Uuid, memberId: Uuid): Promise<void>;
  leaveOrganization(organizationId: Uuid): Promise<void>;
  listOrganizationInvitations(
    organizationId: Uuid,
    page?: Pagination,
  ): Promise<Page<InvitationSummary>>;
  createInvitation(
    organizationId: Uuid,
    input: InvitationInput,
  ): Promise<InvitationSummary>;
  listMyInvitations(page?: Pagination): Promise<Page<InvitationSummary>>;
  resendInvitation(invitationId: Uuid): Promise<InvitationSummary>;
  cancelInvitation(invitationId: Uuid): Promise<void>;
  declineInvitation(invitationId: Uuid): Promise<void>;
  acceptInvitation(invitationId: Uuid): Promise<InvitationAcceptance>;
  listProvisioning(page?: Pagination): Promise<Page<ProvisioningSummary>>;
  getProvisioning(organizationId: Uuid): Promise<ProvisioningSummary>;
  createProvisioning(input: ProvisioningInput): Promise<ProvisioningSummary>;
  resendOwnerInvitation(organizationId: Uuid): Promise<ProvisioningSummary>;
  replaceOwnerEmail(
    organizationId: Uuid,
    input: { email: string },
  ): Promise<ProvisioningSummary>;
  cancelProvisioning(organizationId: Uuid): Promise<void>;
  setAccountDisabled(userId: Uuid, disabled: boolean): Promise<void>;
}
