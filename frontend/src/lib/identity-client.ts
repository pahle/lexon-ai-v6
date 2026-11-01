import { z } from 'zod';
import * as contracts from '@lexon/contracts';
import type { IdentityApi } from '@lexon/contracts';
export class IdentityClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(
      status === 503
        ? 'Service temporarily unavailable.'
        : status === 401
          ? 'Sign in to continue.'
          : 'Unable to complete the request.',
    );
  }
}
interface ClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
}
export function createIdentityClient(options: ClientOptions): IdentityApi {
  if (
    !options.baseUrl.startsWith('/') ||
    options.baseUrl.startsWith('//') ||
    /[\\?#]/.test(options.baseUrl)
  )
    throw new Error('Identity API must use the same origin');
  return buildIdentityClient(options);
}
export function buildIdentityClient(
  options: ClientOptions,
  serverCookie?: string,
): IdentityApi {
  const base = options.baseUrl.replace(/\/$/, '');
  const page = (value: unknown) =>
    contracts.PaginationSchema.partial().parse(value ?? {});
  const id = (value: string) => contracts.UuidSchema.parse(value);
  async function call<T>(
    path: string,
    schema: z.ZodType<T> | null,
    method = 'GET',
    body?: unknown,
  ): Promise<T> {
    let response: Response;
    try {
      response = await (options.fetch ?? globalThis.fetch)(base + path, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(10000),
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(serverCookie ? { cookie: serverCookie } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new IdentityClientError('AUTH_UNAVAILABLE', 503);
    }
    if (!response.ok) {
      let code = 'AUTH_UNAVAILABLE';
      try {
        const data = (await response.json()) as unknown;
        const parsed = contracts.IdentityErrorResponseSchema.safeParse(data);
        if (parsed.success) code = parsed.data.error.code;
        else if (response.status === 401) code = 'AUTH_REQUIRED';
      } catch {
        /* Use the fixed safe fallback for malformed error responses. */
      }
      throw new IdentityClientError(code, response.status);
    }
    if (!schema) return undefined as T;
    try {
      return schema.parse(await response.json());
    } catch {
      throw new IdentityClientError('AUTH_UNAVAILABLE', 503);
    }
  }
  const withPage = (path: string, input: unknown) => {
    const inputPage = page(input);
    const query = new URLSearchParams();
    if (inputPage.limit !== undefined)
      query.set('limit', String(inputPage.limit));
    if (inputPage.cursor) query.set('cursor', inputPage.cursor);
    return path + (query.size ? '?' + query : '');
  };
  const org = (value: string) => `/organizations/${id(value)}`;
  const invite = (value: string) => `/invitations/${id(value)}`;
  const provisioning = (value: string) => `/platform/provisioning/${id(value)}`;
  return {
    identity: () => call('/identity', contracts.IdentitySummarySchema),
    profile: () => call('/identity/profile', contracts.SafeProfileSchema),
    updateProfile: (input) =>
      call(
        '/identity/profile',
        contracts.SafeProfileSchema,
        'PATCH',
        contracts.ProfileInputSchema.parse(input),
      ),
    completeOnboarding: () =>
      call('/identity/onboarding/complete', null, 'POST'),
    security: () => call('/identity/security', contracts.SecurityStateSchema),
    reauthenticate: (input) =>
      call(
        '/identity/security/reauthenticate',
        null,
        'POST',
        contracts.ReauthenticateInputSchema.parse(input),
      ),
    listSessions: () =>
      call('/identity/sessions', z.array(contracts.OwnSessionSummarySchema)),
    revokeSession: (sessionId) =>
      call(`/identity/sessions/${id(sessionId)}`, null, 'DELETE'),
    listOrganizations: (input) =>
      call(
        withPage('/organizations', input),
        contracts.pageSchema(contracts.OrganizationSummarySchema),
      ),
    createOrganization: async (input) =>
      call(
        '/organizations',
        contracts.OrganizationSummarySchema,
        'POST',
        contracts.CreateOrganizationInputSchema.parse(input),
      ),
    switchOrganization: (organizationId) =>
      call('/organizations/active', contracts.SwitchResultSchema, 'POST', {
        organizationId: id(organizationId),
      }),
    updateOrganization: (organizationId, input) =>
      call(
        org(organizationId) + '/settings',
        contracts.OrganizationSummarySchema,
        'PATCH',
        contracts.OrganizationSettingsInputSchema.parse(input),
      ),
    listMembers: (organizationId, input) =>
      call(
        withPage(org(organizationId) + '/members', input),
        contracts.pageSchema(contracts.MemberSummarySchema),
      ),
    changeMemberRole: (organizationId, memberId, role) =>
      call(
        org(organizationId) + `/members/${id(memberId)}`,
        contracts.MemberSummarySchema,
        'PATCH',
        { role: contracts.OrgRoleSchema.parse(role) },
      ),
    removeMember: (organizationId, memberId) =>
      call(org(organizationId) + `/members/${id(memberId)}`, null, 'DELETE'),
    leaveOrganization: (organizationId) =>
      call(org(organizationId) + '/leave', null, 'POST'),
    listOrganizationInvitations: (organizationId, input) =>
      call(
        withPage(org(organizationId) + '/invitations', input),
        contracts.pageSchema(contracts.InvitationSummarySchema),
      ),
    createInvitation: (organizationId, input) =>
      call(
        org(organizationId) + '/invitations',
        contracts.InvitationSummarySchema,
        'POST',
        contracts.InvitationInputSchema.parse(input),
      ),
    listMyInvitations: (input) =>
      call(
        withPage('/identity/invitations', input),
        contracts.pageSchema(contracts.InvitationSummarySchema),
      ),
    resendInvitation: (invitationId) =>
      call(
        invite(invitationId) + '/resend',
        contracts.InvitationSummarySchema,
        'POST',
      ),
    cancelInvitation: (invitationId) =>
      call(invite(invitationId) + '/cancel', null, 'POST'),
    declineInvitation: (invitationId) =>
      call(invite(invitationId) + '/decline', null, 'POST'),
    acceptInvitation: (invitationId) =>
      call(
        invite(invitationId) + '/accept',
        contracts.InvitationAcceptanceSchema,
        'POST',
      ),
    listProvisioning: (input) =>
      call(
        withPage('/platform/provisioning', input),
        contracts.pageSchema(contracts.ProvisioningSummarySchema),
      ),
    getProvisioning: (organizationId) =>
      call(provisioning(organizationId), contracts.ProvisioningSummarySchema),
    createProvisioning: (input) =>
      call(
        '/platform/provisioning',
        contracts.ProvisioningSummarySchema,
        'POST',
        contracts.ProvisioningInputSchema.parse(input),
      ),
    resendOwnerInvitation: (organizationId) =>
      call(
        provisioning(organizationId) + '/resend',
        contracts.ProvisioningSummarySchema,
        'POST',
      ),
    replaceOwnerEmail: (organizationId, input) =>
      call(
        provisioning(organizationId) + '/owner-email',
        contracts.ProvisioningSummarySchema,
        'PATCH',
        { ownerEmail: contracts.EmailAddressSchema.parse(input.email) },
      ),
    cancelProvisioning: (organizationId) =>
      call(provisioning(organizationId), null, 'DELETE'),
    setAccountDisabled: (userId, disabled) =>
      call(`/platform/users/${id(userId)}/disabled`, null, 'PATCH', {
        disabled: z.boolean().parse(disabled),
      }),
  };
}
