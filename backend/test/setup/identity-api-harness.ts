import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Writable } from 'node:stream';
import { pinoHttp } from 'pino-http';
import { createApi } from '../../src/bootstrap/api.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createLoggingOptions } from '../../src/infrastructure/telemetry/logging.js';
import { createAuthEnvironment } from './auth-environment.js';
import type { FileServices } from './provided-context.js';
import type { TransactionalEmail } from '../../src/infrastructure/email/index.js';
import type { SafeProfile } from '@lexon/contracts';
import { totpForUri } from './totp.js';
export async function identityApiHarness(
  services: FileServices,
  limiterUrl?: string,
) {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-privacy-'));
  const env = createAuthEnvironment(services, join(directory, 'health.json'));
  if (limiterUrl) env.VALKEY_LIMITER_URL = limiterUrl;
  const config = loadRuntimeConfig('api', env);
  const mail: TransactionalEmail[] = [];
  const logs: string[] = [];
  const failures: string[] = [];
  const app = await createApi(config, {
    email: {
      send: async (message) => {
        mail.push(message);
        return { messageId: 'test' };
      },
      drain: async () => {},
    },
  });
  await app.listen(0, '127.0.0.1');
  const backend = await app.getUrl();
  const sink = new Writable({
    write(chunk, _encoding, done) {
      logs.push(String(chunk));
      done();
    },
  });
  const logging = pinoHttp(createLoggingOptions('api').pinoHttp, sink);
  const proxy = createServer((request, response) => {
    logging(request, response, () => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(Buffer.from(chunk));
        const raw = Buffer.concat(chunks);
        const headers = new Headers();
        for (const [key, value] of Object.entries(request.headers))
          if (
            value !== undefined &&
            ![
              'host',
              'connection',
              'transfer-encoding',
              'content-length',
            ].includes(key)
          )
            headers.set(key, Array.isArray(value) ? value.join(',') : value);
        const incoming = await fetch(backend + request.url, {
          method: request.method ?? 'GET',
          headers,
          redirect: 'manual',
          ...(raw.length ? { body: raw } : {}),
          signal: AbortSignal.timeout(10000),
        });
        response.statusCode = incoming.status;
        for (const [key, value] of incoming.headers)
          if (
            ![
              'set-cookie',
              'transfer-encoding',
              'connection',
              'content-encoding',
              'content-length',
            ].includes(key)
          )
            response.setHeader(key, value);
        const cookies = incoming.headers.getSetCookie();
        if (cookies.length) response.setHeader('set-cookie', cookies);
        const text = await incoming.text();
        if (incoming.status >= 400) failures.push(text);
        response.end(text);
      })().catch(() => {
        response.statusCode = 503;
        response.end('Unavailable');
      });
    });
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const address = proxy.address();
  if (!address || typeof address === 'string')
    throw new Error('Test proxy missing');
  const origin = 'http://127.0.0.1:' + address.port;
  async function call(
    path: string,
    headers: Record<string, string> = {},
    method = 'GET',
    body?: unknown,
  ) {
    return fetch(origin + '/api' + path, {
      method,
      headers: {
        origin: config.auth.origin,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      redirect: 'manual',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  async function user(name: string) {
    const email = randomUUID() + '@example.test';
    const password = 'Private-password-' + randomUUID() + '!';
    const signed = await call('/auth/sign-up/email', {}, 'POST', {
      name,
      email,
      password,
    });
    if (signed.status !== 200) throw new Error('Test signup failed');
    const message = mail.findLast(
      (item) => item.to === email && item.kind === 'verification',
    );
    if (!message) throw new Error('Test mail missing');
    const url = new URL(message.actionUrl);
    url.searchParams.delete('callbackURL');
    if (
      (await fetch(origin + url.pathname + url.search, { redirect: 'manual' }))
        .status !== 200
    )
      throw new Error('Test verification failed');
    const login = await call('/auth/sign-in/email', {}, 'POST', {
      email,
      password,
    });
    if (login.status !== 200) throw new Error('Test signin failed');
    const headers = {
      cookie: login.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; '),
    };
    const profile = (await (
      await call('/identity/profile', headers)
    ).json()) as SafeProfile;
    return { headers, profile, password };
  }
  async function enroll(actor: Awaited<ReturnType<typeof user>>) {
    const begin = await call('/auth/two-factor/enable', actor.headers, 'POST', {
      password: actor.password,
    });
    if (begin.status !== 200) throw new Error('Test enrollment failed');
    const setup = (await begin.json()) as {
      totpURI: string;
      backupCodes: string[];
    };
    const verified = await call(
      '/auth/two-factor/verify-totp',
      actor.headers,
      'POST',
      { code: totpForUri(setup.totpURI) },
    );
    if (verified.status !== 200) throw new Error('Test MFA failed');
    actor.headers.cookie = verified.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    return setup;
  }
  return {
    config,
    env,
    mail,
    logs,
    failures,
    origin,
    call,
    user,
    enroll,
    async close() {
      proxy.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      );
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
