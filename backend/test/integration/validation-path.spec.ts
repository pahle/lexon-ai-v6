import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';
import { ErrorResponseSchema } from '@lexon/contracts';
import { test } from '../setup/file-services.js';
import { createTestApi, apiHeaders } from '../setup/test-api.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createAuthEnvironment } from '../setup/auth-environment.js';

const endpoints = [
  {
    name: 'chat',
    method: 'POST',
    path: '/api/chats',
    body: { chatId: 'not-a-uuid' },
    field: 'chatId',
  },
  {
    name: 'identity',
    method: 'PATCH',
    path: '/api/identity/profile',
    body: { name: 42 },
    field: 'name',
  },
] as const;

for (const endpoint of endpoints)
  test(`${endpoint.name} endpoint: wrong shape -> 400 VALIDATION_ERROR with issues[].path; unparsable JSON -> 400 INVALID_JSON`, async ({
    services,
  }) => {
    const directory = await mkdtemp(join(tmpdir(), 'lexon-validation-'));
    const app = await createTestApi(
      loadRuntimeConfig(
        'api',
        createAuthEnvironment(services, join(directory, 'health.json')),
      ),
    );
    try {
      await app.listen(0, '127.0.0.1');
      const origin = await app.getUrl();
      const auth = await apiHeaders(app);
      const send = (body: string) =>
        fetch(origin + endpoint.path, {
          method: endpoint.method,
          headers: { ...auth, 'content-type': 'application/json' },
          body,
        });
      const shaped = await send(JSON.stringify(endpoint.body));
      expect(shaped.status).toBe(400);
      const parsed = ErrorResponseSchema.parse(await shaped.json());
      expect(parsed.error.code).toBe('VALIDATION_ERROR');
      expect(parsed.error.issues?.length).toBeGreaterThan(0);
      expect(parsed.error.issues?.map((issue) => issue.path)).toContain(
        endpoint.field,
      );
      const broken = await send('{not json');
      expect(broken.status).toBe(400);
      expect(ErrorResponseSchema.parse(await broken.json()).error.code).toBe(
        'INVALID_JSON',
      );
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
