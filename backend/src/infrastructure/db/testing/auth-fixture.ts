import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  Body,
  Controller,
  Module,
  Post,
  type INestApplication,
  type DynamicModule,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import type { BetterAuthOptions } from 'better-auth';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { composeAuthIntegration } from '../auth/auth-integration.js';
import { createAuthInspector } from './auth-inspect.js';
import nodemailer from 'nodemailer';
import { SmtpMailer } from '../../email/index.js';
import type { AuthEngineOptions } from '../auth/auth-types.js';
export type { AuthCommandSession } from '../auth/auth-types.js';

@Controller('probe')
class ProbeController {
  @Post()
  probe(@Body() body: { value: string }) {
    return body;
  }
}

export async function createAuthFixture(
  services: { authUrl: string; migratorUrl: string; appUrl?: string },
  options: {
    rejectSignupResponse?: boolean;
    policy?: AuthEngineOptions['policy'];
    mailTransport?: import('../../email/index.js').MailTransport;
  } = {},
) {
  const origin = 'http://localhost:3000';
  const mail = new Map<string, string>();
  const mailer = new SmtpMailer({
    origin,
    from: 'lexon@example.test',
    transport:
      options.mailTransport ??
      nodemailer.createTransport({
        streamTransport: true,
        buffer: true,
      }),
  });
  const { auth, integration } = await composeAuthIntegration({
    authUrl: services.authUrl,
    origin,
    secret: randomBytes(48).toString('base64url'),
    ...(options.policy ? { policy: options.policy } : {}),
    plugins: options.rejectSignupResponse
      ? [
          {
            id: 'failed-response-probe',
            hooks: {
              after: [
                {
                  matcher: (context) => context.path === '/sign-up/email',
                  handler: createAuthMiddleware(async () => {
                    throw new APIError('BAD_REQUEST', {
                      message: 'Injected response failure',
                    });
                  }),
                },
              ],
            },
          },
        ]
      : [],
    mail: {
      sendInvitation: async ({ email, url, organizationName }) => {
        await mailer.send({
          kind: 'invitation',
          to: email,
          actionUrl: url,
          organizationName,
        });
        mail.set(`invitation:${email}`, url);
      },
      sendVerification: async ({ email, url }) => {
        await mailer.send({ kind: 'verification', to: email, actionUrl: url });
        mail.set(email, url);
      },
      sendPasswordReset: async ({ email, url }) => {
        await mailer.send({ kind: 'reset', to: email, actionUrl: url });
        mail.set(`reset:${email}`, url);
      },
    },
  });
  const inspect = createAuthInspector(services);
  let app: INestApplication | undefined;
  let lastResponse: Response | undefined;
  const nativeHandler = auth.handler;
  // Capture the native Response before the integration's commit barrier. This
  // instrumentation exists only in the excluded test harness.
  auth.handler = async (request) => {
    lastResponse = await nativeHandler(request);
    return lastResponse;
  };
  return {
    origin,
    integration,
    inspect,
    mailWasDispatched: (email: string) => mail.has(email),
    dispatchedLink: (
      email: string,
      kind: 'verification' | 'reset' | 'invitation' = 'verification',
    ) => mail.get(kind === 'verification' ? email : `${kind}:${email}`),
    mailDeliveryState: () => mailer.deliveryState(),
    drainMail: () => mailer.drain(1000),
    pluginIds: () => auth.options.plugins.map((plugin) => plugin.id),
    nativeSettings: () => {
      const options: BetterAuthOptions = auth.options;
      return {
        cookieCacheDisabled: options.session?.cookieCache?.enabled === false,
        secondaryStorageDisabled: options.secondaryStorage === undefined,
        nativeRateLimitDisabled: options.rateLimit?.enabled === false,
        telemetryDisabled: options.telemetry?.enabled === false,
      };
    },
    lastNativeResponse: () => lastResponse,
    endpointInventory() {
      const endpoints = Object.values(auth.api) as Array<{
        path?: string;
        options: { method?: string | readonly string[]; scope?: string };
      }>;
      return endpoints.flatMap((endpoint) => {
        if (!endpoint.path || endpoint.options.scope === 'server') return [];
        const declared = endpoint.options.method ?? 'GET';
        const methods =
          declared === '*'
            ? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
            : typeof declared === 'string'
              ? [declared]
              : declared;
        return methods.map((method) => ({ method, path: endpoint.path! }));
      });
    },
    async nativeImpersonationDenied(headers: Headers, userId: string) {
      const response = await integration.transaction(() =>
        auth.api.impersonateUser({
          headers,
          body: { userId },
          asResponse: true,
        }),
      );
      return response.status === 403;
    },
    async startNest(
      options: {
        handler?: (request: Request) => Promise<Response>;
        middleware?: (
          req: IncomingMessage & { originalUrl?: string },
          res: ServerResponse,
          next: () => void,
        ) => void;
        moduleFactory?: (options: {
          integration: typeof integration;
          frameworkModule: DynamicModule;
        }) => DynamicModule;
      } = {},
    ) {
      const frameworkModule = AuthModule.forRoot({
        auth: { ...auth, handler: options.handler ?? integration.handle },
        disableGlobalAuthGuard: true,
        isGlobal: false,
        disableTrustedOriginsCors: true,
        ...(options.middleware ? { middleware: options.middleware } : {}),
        bodyParser: {
          json: { limit: '1kb' },
          urlencoded: { enabled: false },
        },
      });
      @Module({
        imports: [
          options.moduleFactory
            ? options.moduleFactory({ integration, frameworkModule })
            : frameworkModule,
        ],
        controllers: [ProbeController],
      })
      class CompatibilityModule {}
      app = await NestFactory.create(CompatibilityModule, {
        bodyParser: false,
        logger: false,
        abortOnError: false,
      });
      app.setGlobalPrefix('api');
      await app.listen(0, '127.0.0.1');
      return app.getUrl();
    },
    async signIn(input: {
      body: { email: string; password: string; name: string };
    }) {
      const signup = await integration.transaction((tx) =>
        tx.call('signUpEmail', input),
      );
      const url = mail.get(input.body.email);
      if (!url) throw new Error('Verification email missing');
      const verificationUrl = new URL(url);
      verificationUrl.searchParams.delete('callbackURL');
      const verified = await integration.handle(new Request(verificationUrl));
      if (verified.status !== 200) throw new Error('Verification failed');
      const response = await integration.handle(
        new Request(`${origin}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin },
          body: JSON.stringify({
            email: input.body.email,
            password: input.body.password,
          }),
        }),
      );
      if (response.status !== 200) throw new Error('Sign-in failed');
      const cookie = response.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; ');
      const token = response.headers.get('set-auth-token');
      if (!cookie || !token) throw new Error('Session credentials missing');
      return {
        userId: signup.user.id,
        cookieHeaders: new Headers({ cookie }),
        bearerHeaders: new Headers({ authorization: `Bearer ${token}` }),
      };
    },
    async close() {
      try {
        await app?.close();
      } finally {
        await Promise.all([
          integration.close(),
          inspect.close(),
          mailer.onApplicationShutdown(),
        ]);
      }
    },
  };
}
