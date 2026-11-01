import type { DynamicModule } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { ApiConfig } from '../../config/runtime-config.js';
import { createAuthRuntime } from '../../infrastructure/db/index.js';
import { AuthLimitError } from '../../infrastructure/queue/index.js';
import { IdentityPolicy } from './identity-policy.js';
import { IdentityError } from './identity-error.js';
import { resolveClientAddress } from './client-address.js';
import { createAuthLimiter } from '../../infrastructure/queue/index.js';
import {
  SmtpMailer,
  type EmailPort,
} from '../../infrastructure/email/index.js';
import { IdentityAccessModule } from './identity-access.module.js';
import { OrganizationAuthPort } from './organization-auth.port.js';
import { IdentitySessionService } from './identity-session.service.js';
import { AccountService } from './account.service.js';
import { SecurityService } from './security.service.js';
import { AccountController } from './account.controller.js';
import { SecurityController } from './security.controller.js';
import { createAuthHttp, createAuthRequestContext } from './auth-http.js';
export async function createIdentityRuntime(
  config: ApiConfig,
  email?: EmailPort,
) {
  const settings = config.auth;
  const mail =
    email ??
    new SmtpMailer({
      origin: settings.origin,
      from: settings.smtp.from,
      url: settings.smtp.url,
    });
  let runtime: Awaited<ReturnType<typeof createAuthRuntime>> | undefined;
  let limiter: Awaited<ReturnType<typeof createAuthLimiter>> | undefined;
  const close = async () => {
    await Promise.allSettled([
      runtime?.integration.close(),
      limiter?.close(),
      mail.drain(2000),
      ...(mail instanceof SmtpMailer ? [mail.onApplicationShutdown()] : []),
    ]);
  };
  try {
    runtime = await createAuthRuntime({
      authUrl: settings.database.authUrl,
      origin: settings.origin,
      secret: settings.secret,
      policy: settings,
      mail: {
        sendVerification: async ({ email, url }) => {
          await mail.send({ kind: 'verification', to: email, actionUrl: url });
        },
        sendPasswordReset: async ({ email, url }) => {
          await mail.send({ kind: 'reset', to: email, actionUrl: url });
        },
        sendInvitation: async ({ email, url, organizationName }) => {
          await mail.send({
            kind: 'invitation',
            to: email,
            actionUrl: url,
            organizationName,
          });
        },
      },
    });
    const integration = runtime.integration;
    limiter = await createAuthLimiter({
      url: config.valkey.limiterUrl,
      prefix: `${config.queuePrefix}:rl:auth:`,
      rules: settings.rateRules,
    });
    const accounts = new AccountService(integration, {
      openSignup: settings.openSignup,
      audit: {
        secret: settings.auditHmacSecret,
        keyId: settings.auditHmacKeyId,
      },
    });
    const security = new SecurityService(integration, {
      reauthSeconds: settings.reauthSeconds,
    });
    const context = createAuthRequestContext();
    const handler = createAuthHttp(integration, {
      origin: settings.origin,
      correlationSecret: settings.auditHmacSecret,
      trustedProxies: settings.trustedProxies,
      limiter,
      context: context.read,
      accountKey: async (_rule, request) =>
        integration.transaction(async (tx) => {
          const facts = await security.facts(tx, request.headers);
          return facts.user
            ? createHash('sha256').update(facts.user.id).digest('hex')
            : undefined;
        }),
      authorize: async (rule, { tx, body, request }) => {
        if (
          rule.scope === 'own-security' &&
          !['/get-session', '/sign-out'].includes(rule.path)
        ) {
          const facts = await security.facts(tx, request.headers);
          if (!facts.user || !facts.session)
            throw new IdentityError('AUTH_REQUIRED', 401);
          new IdentityPolicy().requireAccount(
            facts.user,
            facts.session.mfaVerifiedAt,
          );
        }
        if (rule.path === '/sign-up/email')
          await accounts.authorizeSignup(tx, {
            name: body.name,
            email: body.email,
            password: body.password,
            ...(body.invitationId ? { invitationId: body.invitationId } : {}),
            ...(body.setupToken ? { setupToken: body.setupToken } : {}),
          });
        const accountDone = await accounts.prepareOperation(
          tx,
          rule.path,
          {
            ...body,
            ...(new URL(request.url).searchParams.get('token')
              ? { token: new URL(request.url).searchParams.get('token') }
              : {}),
          },
          request.headers,
        );
        const securityDone = await security.prepareOperation(
          tx,
          rule.path,
          body,
          request.headers,
        );
        return async (response) => accountDone(await securityDone(response));
      },
      failed: async (rule, body, request) => {
        if (rule.path === '/sign-in/email')
          await accounts.recordFailedSignIn(String(body.email ?? ''));
        else if (rule.scope === 'challenge')
          await security.recordFailedFactor(request.headers);
      },
    });
    const port = new OrganizationAuthPort(integration);
    const selection = new IdentitySessionService(integration);
    const module: DynamicModule = IdentityAccessModule.forPolicy({
      integration,
      frameworkModule: runtime.mount(handler, context.middleware),
      bearerSeconds: settings.bearerSeconds,
      reauthSeconds: settings.reauthSeconds,
      requestPolicy: async (request, headers, userId) => {
        // Express has already matched a controller route. Use its canonical
        // template so accepted case/trailing-slash aliases share one policy.
        const route = request.route as { path?: unknown } | undefined;
        const path = typeof route?.path === 'string' ? route.path : '';
        if (!path) throw new IdentityError('AUTH_REQUIRED', 403);
        if (path.startsWith('/api/health')) return;
        try {
          if (!userId && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
            const origin = headers.get('origin');
            if (
              (origin && origin !== settings.origin) ||
              (headers.has('cookie') &&
                !headers.has('authorization') &&
                origin !== settings.origin) ||
              headers.get('sec-fetch-site') === 'cross-site'
            )
              throw new IdentityError('AUTH_REQUIRED', 403);
          }
          const action = path.endsWith('/admin-setup/redeem')
            ? 'setup-redemption'
            : path.endsWith('/bearer-sessions') && request.method === 'POST'
              ? 'bearer-issuance'
              : path.endsWith('/security/reauthenticate')
                ? 'signin'
                : null;
          if (action) {
            const clientAddress = resolveClientAddress(
              request.socket.remoteAddress ?? '',
              headers,
              settings.trustedProxies,
            );
            const accountKey = userId
              ? createHash('sha256').update(userId).digest('hex')
              : undefined;
            await limiter!.consume({
              action,
              clientAddress,
              scope: userId ? 'account' : 'ip',
              ...(accountKey ? { accountKey } : {}),
            });
            if (
              path.endsWith('/security/reauthenticate') &&
              userId &&
              (request.body?.totp || request.body?.recoveryCode)
            )
              await limiter!.consume({
                action: request.body.recoveryCode ? 'recovery' : 'totp',
                clientAddress,
                ...(accountKey ? { accountKey } : {}),
              });
          }
        } catch (error) {
          if (error instanceof AuthLimitError)
            throw new IdentityError(error.code, error.status);
          throw error;
        }
      },
    });
    module.controllers = [
      ...(module.controllers ?? []),
      AccountController,
      SecurityController,
    ];
    module.providers = [
      { provide: AccountService, useValue: accounts },
      { provide: SecurityService, useValue: security },
      ...(module.providers ?? []),
      {
        provide: 'IdentityRuntimeShutdown',
        useValue: { onApplicationShutdown: close },
      },
    ];
    return {
      module,
      port,
      selection,
      accounts,
      security,
      check: integration.check,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
