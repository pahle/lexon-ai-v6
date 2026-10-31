import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { organization } from 'better-auth/plugins/organization';
import { admin } from 'better-auth/plugins/admin';
import { defaultAc, userAc } from 'better-auth/plugins/admin/access';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { bearer } from 'better-auth/plugins/bearer';
import type { AuthEngineOptions } from './auth-types.js';

// Private composition shared by schema generation and the runtime boundary.
export function createAuthEngine(
  options: AuthEngineOptions,
  database: BetterAuthOptions['database'],
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
      sendResetPassword: async ({ user, url }) =>
        options.mail.sendPasswordReset({ email: user.email, url }),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }) =>
        options.mail.sendVerification({ email: user.email, url }),
    },
    session: {
      expiresIn: 604800,
      updateAge: 86400,
      freshAge: 300,
      cookieCache: { enabled: false },
      additionalFields: {
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
      organization({
        allowUserToCreateOrganization:
          options.pluginConfiguration?.allowUserToCreateOrganization ?? true,
        invitationExpiresIn: 1209600,
        schema: {
          organization: {
            additionalFields: {
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
