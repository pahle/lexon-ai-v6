import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import {
  Body,
  Controller,
  Module,
  Post,
  type INestApplication,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { composeAuthIntegration } from '../auth/auth-integration.js';
import { createAuthInspector } from './auth-inspect.js';
import nodemailer from 'nodemailer';
import { SmtpMailer } from '../../email/index.js';
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
  options: { rejectSignupResponse?: boolean } = {},
) {
  const origin = 'http://localhost:3000';
  const mail = new Map<string, string>();
  const mailer = new SmtpMailer({
    origin,
    from: 'lexon@example.test',
    transport: nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
    }),
  });
  const { auth, integration } = await composeAuthIntegration({
    authUrl: services.authUrl,
    origin,
    secret: randomBytes(48).toString('base64url'),
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
      sendVerification: async ({ email, url }) => {
        await mailer.send({ kind: 'verification', to: email, actionUrl: url });
        // Fixture-only synchronization: production delivery never determines
        // account-existence-sensitive response timing.
        await mailer.drain(1000);
        mail.set(email, url);
      },
      sendPasswordReset: async ({ email, url }) => {
        await mailer.send({ kind: 'reset', to: email, actionUrl: url });
        await mailer.drain(1000);
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
    mailWasDelivered: (email: string) => mail.has(email),
    pluginIds: () => auth.options.plugins.map((plugin) => plugin.id),
    lastNativeResponse: () => lastResponse,
    async startNest() {
      @Module({
        imports: [
          AuthModule.forRoot({
            auth: { ...auth, handler: integration.handle },
            disableGlobalAuthGuard: true,
            bodyParser: {
              json: { limit: '1kb' },
              urlencoded: { enabled: false },
            },
          }),
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
