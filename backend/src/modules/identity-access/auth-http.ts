import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  SignUpInputSchema,
  SignInInputSchema,
  ProfileInputSchema,
  PasswordChangeInputSchema,
  PasswordResetInputSchema,
  PasswordResetRequestInputSchema,
  EmailChangeInputSchema,
  ExistingPasswordSchema,
  TotpInputSchema,
  RecoveryCodeInputSchema,
} from '@lexon/contracts';
import type {
  AuthIntegration,
  AuthCommandSession,
} from '../../infrastructure/db/index.js';
import {
  AuthLimitError,
  type AuthLimiter,
} from '../../infrastructure/queue/index.js';
import {
  classifyAuthEndpoint,
  type AuthEndpointRule,
} from './auth-endpoints.js';
import {
  sanitizeAuthResponse,
  normalizeAuthDestination,
} from './auth-output.js';
import { IdentityError } from './identity-error.js';
import { resolveClientAddress } from './client-address.js';

const MAX_BODY_BYTES = 32768;
interface AuthRequestContext {
  rawPath: string;
  peerAddress: string;
}
export type AuthNodeMiddleware = (
  req: IncomingMessage & { originalUrl?: string },
  res: ServerResponse,
  next: () => void,
) => void;
function errorResponse(
  code: ConstructorParameters<typeof IdentityError>[0],
  status: number,
): Response {
  return Response.json(
    { error: { code, message: new IdentityError(code, status).message } },
    {
      status,
      headers: {
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
        ...(status === 413 ? { connection: 'close' } : {}),
      },
    },
  );
}
export function createAuthRequestContext() {
  const storage = new AsyncLocalStorage<AuthRequestContext>();
  const middleware: AuthNodeMiddleware = (req, res, next) => {
    const rawPath = req.originalUrl ?? req.url ?? '';
    const rule = classifyAuthEndpoint(req.method ?? '', rawPath);
    const size = Number(req.headers['content-length'] ?? 0);
    const status = !rule
      ? 404
      : !Number.isSafeInteger(size) || size > MAX_BODY_BYTES
        ? 413
        : 0;
    if (status) {
      res.statusCode = status;
      res.setHeader('cache-control', 'no-store');
      res.end();
      req.resume();
      return;
    }
    storage.run({ rawPath, peerAddress: req.socket.remoteAddress ?? '' }, next);
  };
  return {
    middleware,
    read: () => {
      const value = storage.getStore();
      if (!value) throw new IdentityError('AUTH_UNAVAILABLE', 503);
      return value;
    },
  };
}
export interface AuthHttpPolicyDependencies {
  origin: string;
  correlationSecret: string;
  trustedProxies?: readonly string[];
  limiter: Pick<AuthLimiter, 'consume' | 'assertAvailable'>;
  context: () => AuthRequestContext;
  authorize: (
    rule: AuthEndpointRule,
    input: {
      request: Request;
      body: Record<string, unknown>;
      tx: AuthCommandSession;
    },
  ) => Promise<void | ((response: Response) => Promise<Response>)>;
  failed?: (
    rule: AuthEndpointRule,
    body: Record<string, unknown>,
  ) => Promise<void>;
  // Required before non-public attempts can run; resolve from trusted identity
  // facts, never a client-supplied account key. It must not mutate auth state.
  accountKey?: (
    rule: AuthEndpointRule,
    request: Request,
    body: Record<string, unknown>,
  ) => Promise<string | undefined>;
}
async function readBody(request: Request): Promise<unknown> {
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        throw new IdentityError('VALIDATION_ERROR', 413);
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof IdentityError) throw error;
    throw new IdentityError('VALIDATION_ERROR', 400);
  } finally {
    reader.releaseLock();
  }
}
function sameOrigin(value: string, origin: string): boolean {
  return normalizeAuthDestination(value, origin) !== null;
}
function bodySchema(path: string, origin: string): z.ZodType {
  const callback = z
    .string()
    .max(4096)
    .refine((value) => sameOrigin(value, origin));
  switch (path) {
    case '/sign-up/email':
      return SignUpInputSchema.extend({ callbackURL: callback.optional() });
    case '/sign-in/email':
      return SignInInputSchema.extend({ callbackURL: callback.optional() });
    case '/update-user':
      return ProfileInputSchema;
    case '/change-password':
      return PasswordChangeInputSchema;
    case '/reset-password':
      return PasswordResetInputSchema;
    case '/request-password-reset':
      return PasswordResetRequestInputSchema.extend({
        redirectTo: callback.optional(),
      });
    case '/send-verification-email':
      return PasswordResetRequestInputSchema.extend({
        callbackURL: callback.optional(),
      });
    case '/change-email':
      return EmailChangeInputSchema.extend({
        callbackURL: callback.optional(),
      });
    case '/two-factor/verify-totp':
      return TotpInputSchema;
    case '/two-factor/verify-backup-code':
      return RecoveryCodeInputSchema;
    case '/two-factor/enable':
    case '/two-factor/get-totp-uri':
    case '/two-factor/disable':
    case '/two-factor/generate-backup-codes':
      return z.strictObject({ password: ExistingPasswordSchema });
    default:
      return z.strictObject({});
  }
}
export function createAuthHttp(
  integration: AuthIntegration,
  deps: AuthHttpPolicyDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let failure: Response | undefined;
    let failedAttempt:
      { rule: AuthEndpointRule; body: Record<string, unknown> } | undefined;
    const abort = new Error('Auth operation failed');
    try {
      const context = deps.context();
      const rule = classifyAuthEndpoint(request.method, context.rawPath);
      if (!rule) return errorResponse('VALIDATION_ERROR', 404);
      const authorization = request.headers.get('authorization');
      const cookie = request.headers.get('cookie');
      if (authorization && (!/^Bearer [^\s,]+$/i.test(authorization) || cookie))
        throw new IdentityError('AUTH_REQUIRED', 401);
      const channel = authorization ? 'bearer' : 'cookie';
      const origin = request.headers.get('origin');
      if (
        (origin && origin !== deps.origin) ||
        request.headers.get('sec-fetch-site') === 'cross-site'
      )
        throw new IdentityError('AUTH_REQUIRED', 403);
      if (
        request.method === 'POST' &&
        channel === 'cookie' &&
        origin !== deps.origin
      )
        throw new IdentityError('AUTH_REQUIRED', 403);
      const url = new URL(request.url);
      for (const name of [
        'callbackURL',
        'redirectTo',
        'errorCallbackURL',
        'newUserCallbackURL',
      ]) {
        const values = url.searchParams.getAll(name);
        if (
          values.length > 1 ||
          values.some((value) => !sameOrigin(value, deps.origin))
        )
          throw new IdentityError('VALIDATION_ERROR', 400);
      }
      let body: Record<string, unknown> = {};
      if (request.method === 'POST') {
        if (
          !/^application\/json(?:\s*;|$)/i.test(
            request.headers.get('content-type') ?? '',
          )
        )
          throw new IdentityError('VALIDATION_ERROR', 400);
        const result = bodySchema(rule.path, deps.origin).safeParse(
          await readBody(request),
        );
        if (!result.success) throw new IdentityError('VALIDATION_ERROR', 400);
        body = result.data as Record<string, unknown>;
      }
      const clientAddress = resolveClientAddress(
        context.peerAddress,
        request.headers,
        deps.trustedProxies ?? [],
      );
      if (rule.action) {
        let accountKey: string | undefined;
        if (rule.scope === 'public' && typeof body.email === 'string')
          accountKey = createHmac('sha256', deps.correlationSecret)
            .update('lexon.auth.limit.email.v1\0')
            .update(body.email.trim().toLowerCase())
            .digest('hex');
        else if (rule.scope !== 'public') {
          await deps.limiter.assertAvailable();
          accountKey = await deps.accountKey?.(rule, request, body);
          if (!accountKey) throw new IdentityError('AUTH_REQUIRED', 401);
        }
        await deps.limiter.consume({
          action: rule.action,
          clientAddress,
          ...(accountKey ? { accountKey } : {}),
        });
      } else await deps.limiter.assertAvailable();
      const headers = new Headers(request.headers);
      headers.delete('content-length');
      for (const name of [
        'forwarded',
        'x-forwarded-for',
        'x-forwarded-host',
        'x-forwarded-proto',
        'x-real-ip',
      ])
        headers.delete(name);
      headers.set('x-lexon-client-address', clientAddress);
      if (rule.path === '/change-password') body.revokeOtherSessions = true;
      const forwarded = new Request(request.url, {
        method: request.method,
        headers,
        ...(request.method === 'POST' ? { body: JSON.stringify(body) } : {}),
      });
      const response = await integration.transaction(async (tx) => {
        const complete = await deps.authorize(rule, {
          request: forwarded,
          body,
          tx,
        });
        const native = await integration.handle(forwarded);
        if (native.status >= 400) {
          failure = native;
          failedAttempt = { rule, body };
          throw abort;
        }
        return complete ? complete(native) : native;
      });
      if (
        rule.path === '/sign-up/email' ||
        rule.path === '/request-password-reset' ||
        rule.path === '/send-verification-email'
      )
        return Response.json(
          { status: true },
          {
            headers: {
              'cache-control': 'no-store',
              'referrer-policy': 'no-referrer',
            },
          },
        );
      return await sanitizeAuthResponse(response, channel, deps.origin);
    } catch (error) {
      if (error === abort && failure) {
        if (failedAttempt) {
          try {
            await deps.failed?.(failedAttempt.rule, failedAttempt.body);
          } catch {
            return errorResponse('AUTH_UNAVAILABLE', 503);
          }
          if (
            failedAttempt.rule.path === '/sign-in/email' &&
            failure.status < 500
          )
            return errorResponse('AUTH_REQUIRED', 401);
        }
        return sanitizeAuthResponse(
          failure,
          request.headers.has('authorization') ? 'bearer' : 'cookie',
          deps.origin,
        );
      }
      if (error instanceof IdentityError || error instanceof AuthLimitError)
        return errorResponse(error.code, error.status);
      return errorResponse('AUTH_UNAVAILABLE', 503);
    }
  };
}
