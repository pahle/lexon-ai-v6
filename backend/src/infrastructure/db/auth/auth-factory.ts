import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { organization } from 'better-auth/plugins/organization';
import { admin } from 'better-auth/plugins/admin';
import { defaultAc, userAc } from 'better-auth/plugins/admin/access';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { bearer } from 'better-auth/plugins/bearer';
import type { AuthEngineOptions } from './auth-types.js';
import { sessionPlugin } from './session-plugin.js';
import { invitationPlugin } from './invitation-plugin.js';
import { accountPlugin, type AccountLocks } from './account-plugin.js';
import { securityPlugin, type SecurityPrimitives } from './security-plugin.js';
import {
  organizationPrimitivesPlugin,
  type OrganizationPrimitives,
} from './organization-plugin.js';
import {
  selectionPlugin,
  type SelectionPrimitives,
} from './selection-plugin.js';

// Private composition shared by schema generation and the runtime boundary.
export function createAuthEngine(
  options: AuthEngineOptions,
  database: BetterAuthOptions['database'],
  locks: AccountLocks = {
    grants: async () => {
      throw new Error('Auth transaction unavailable');
    },
    user: async () => {
      throw new Error('Auth transaction unavailable');
    },
  },
  security: SecurityPrimitives = {
    lock: async () => {
      throw new Error('Auth transaction unavailable');
    },
    write: async () => {
      throw new Error('Auth transaction unavailable');
    },
  },
  organizations: OrganizationPrimitives = {
    lock: async () => {
      throw new Error('Auth transaction unavailable');
    },
  },
  selection: SelectionPrimitives = {
    lock: async () => {
      throw new Error('Auth transaction unavailable');
    },
    write: async () => {
      throw new Error('Auth transaction unavailable');
    },
  },
) {
  return betterAuth({
    appName: 'Lexon',
    baseURL: options.origin,
    basePath: '/api/auth',
    secret: options.secret,
    trustedOrigins: [options.origin],
    database,
    telemetry: { enabled: false },
    rateLimit: { enabled: false },
    logger: { disabled: true },
    advanced: {
      database: { generateId: 'uuid' },
      ipAddress: { ipAddressHeaders: ['x-lexon-client-address'] },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      requireEmailVerification: true,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: options.policy?.resetSeconds ?? 1800,
      sendResetPassword: async ({ user, url }) =>
        options.mail.sendPasswordReset({ email: user.email, url }),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      expiresIn: options.policy?.verificationSeconds ?? 3600,
      sendVerificationEmail: async ({ user, url }) =>
        options.mail.sendVerification({ email: user.email, url }),
    },
    session: {
      expiresIn: options.policy?.cookieSeconds ?? 604800,
      updateAge: options.policy?.cookieRefreshSeconds ?? 86400,
      freshAge: options.policy?.reauthSeconds ?? 300,
      cookieCache: { enabled: false },
      additionalFields: {
        activeOrganizationName: {
          type: 'string',
          required: false,
          input: false,
        },
        selectionVersion: {
          type: 'number',
          defaultValue: 0,
          required: true,
          input: false,
        },
        channel: {
          type: ['cookie', 'bearer'],
          defaultValue: 'cookie',
          required: true,
          input: false,
        },
        hardExpiresAt: { type: 'date', required: false, input: false },
        authenticatedAt: { type: 'date', required: false, input: false },
        reauthenticatedAt: { type: 'date', required: false, input: false },
        mfaVerifiedAt: { type: 'date', required: false, input: false },
        pendingOrganizationId: {
          type: 'string',
          required: false,
          input: false,
        },
      },
    },
    user: {
      changeEmail: { enabled: true },
      additionalFields: {
        onboardingComplete: {
          type: 'boolean',
          defaultValue: false,
          required: true,
          input: false,
        },
        pendingAdminActivation: {
          type: 'boolean',
          defaultValue: false,
          required: true,
          input: false,
        },
      },
    },
    plugins: [
      invitationPlugin(organizations, async (invitation, organization) => {
        if (!options.mail.sendInvitation)
          throw new Error('Invitation delivery unavailable');
        const url = new URL('/accept-invitation', options.origin);
        url.searchParams.set('id', invitation.id);
        await options.mail.sendInvitation({
          email: invitation.email,
          url: url.toString(),
          organizationName: organization.name,
        });
      }),
      accountPlugin(locks),
      securityPlugin(security),
      sessionPlugin(security),
      organizationPrimitivesPlugin(organizations),
      selectionPlugin(selection),
      organization({
        sendInvitationEmail: async ({
          id,
          email,
          organization,
        }: {
          id: string;
          email: string;
          organization: { name: string };
        }) => {
          if (!options.mail.sendInvitation) return;
          const url = new URL('/accept-invitation', options.origin);
          url.searchParams.set('id', id);
          await options.mail.sendInvitation({
            email,
            url: url.toString(),
            organizationName: organization.name,
          });
        },
        allowUserToCreateOrganization:
          options.pluginConfiguration?.allowUserToCreateOrganization ?? true,
        invitationExpiresIn: options.policy?.invitationSeconds ?? 1209600,
        schema: {
          organization: {
            additionalFields: {
              policyVersion: {
                type: 'number',
                defaultValue: 0,
                required: true,
                input: false,
              },
              kind: {
                type: ['personal', 'team'],
                defaultValue: 'team',
                required: true,
                input: false,
              },
              state: {
                type: ['provisioning', 'active'],
                defaultValue: 'active',
                required: true,
                input: false,
              },
              require2fa: {
                type: 'boolean',
                defaultValue: false,
                required: true,
                input: false,
              },
              personalOwnerId: {
                type: 'string',
                required: false,
                input: false,
              },
            },
          },
          invitation: {
            additionalFields: {
              acceptedByUserId: {
                type: 'string',
                required: false,
                input: false,
              },
              purpose: {
                type: ['team', 'first_owner'],
                defaultValue: 'team',
                required: true,
                input: false,
              },
              acceptedAt: { type: 'date', required: false, input: false },
              lastSentAt: { type: 'date', required: false, input: false },
              replacedByInvitationId: {
                type: 'string',
                required: false,
                input: false,
              },
            },
          },
        },
      }),
      admin({
        roles: {
          admin: defaultAc.newRole({ user: ['ban'], session: ['revoke'] }),
          user: userAc,
        },
        adminRoles: ['admin'],
      }),
      twoFactor({ issuer: options.pluginConfiguration?.issuer ?? 'Lexon' }),
      bearer(),
      ...(options.plugins ?? []),
    ],
  });
}
