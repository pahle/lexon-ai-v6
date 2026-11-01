import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { ApiConfig } from '../../src/config/runtime-config.js';
import { createApi } from '../../src/bootstrap/api.js';
import type { TransactionalEmail } from '../../src/infrastructure/email/index.js';
const instances = new WeakMap<
  INestApplication,
  { config: ApiConfig; mail: TransactionalEmail[] }
>();
export async function createTestApi(
  config: ApiConfig,
): Promise<INestApplication> {
  const mail: TransactionalEmail[] = [];
  const app = await createApi(config, {
    email: {
      send: async (message) => {
        mail.push(message);
        return { messageId: 'test' };
      },
      drain: async () => {},
    },
  });
  instances.set(app, { config, mail });
  return app;
}
export async function apiHeaders(
  app: INestApplication,
): Promise<Record<string, string>> {
  const state = instances.get(app);
  if (!state) throw new Error('Missing test API');
  const origin = await app.getUrl();
  const email = `${randomUUID()}@example.test`;
  const password = 'Authenticated-test-api-42!';
  const headers = {
    'content-type': 'application/json',
    origin: state.config.auth.origin,
  };
  const signup = await fetch(`${origin}/api/auth/sign-up/email`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: 'API test user', email, password }),
  });
  if (signup.status !== 200) throw new Error('Test signup failed');
  const message = state.mail.findLast(
    (item) => item.to === email && item.kind === 'verification',
  );
  if (!message) throw new Error('Test verification missing');
  const url = new URL(message.actionUrl);
  url.searchParams.delete('callbackURL');
  if ((await fetch(origin + url.pathname + url.search)).status !== 200)
    throw new Error('Test verification failed');
  const signin = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password }),
  });
  if (signin.status !== 200) throw new Error('Test sign-in failed');
  return {
    cookie: signin.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; '),
    origin: state.config.auth.origin,
  };
}
