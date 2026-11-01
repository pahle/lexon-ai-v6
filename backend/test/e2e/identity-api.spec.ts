import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { descriptor } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';
test('cookie and independently selected hard-expiry Bearer sessions obey the same production guard', async ({
  request,
  playwright,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(request);
  const own = (await (
    await request.get(stack.apiUrl + '/api/identity')
  ).json()) as { organization: { id: string } };
  const response = await request.post(
    stack.apiUrl + '/api/identity/bearer-sessions',
    { headers, data: {} },
  );
  expect(response.status()).toBe(201);
  const issued = (await response.json()) as {
    token: string;
    sessionId: string;
    expiresAt: string;
  };
  expect(new Date(issued.expiresAt).getTime() <= Date.now() + 900000).toBe(
    true,
  );
  const bearer = await playwright.request.newContext({
    extraHTTPHeaders: { authorization: 'Bearer ' + issued.token },
  });
  try {
    expect((await bearer.get(stack.apiUrl + '/api/identity')).status()).toBe(
      200,
    );
    const teamResponse = await request.post(
      stack.apiUrl + '/api/organizations',
      {
        headers,
        data: {
          name: 'API session team',
          slug: 'api-' + randomUUID().slice(0, 8),
        },
      },
    );
    expect(teamResponse.status()).toBe(201);
    const team = (await teamResponse.json()) as { id: string };
    expect(
      (
        await bearer.post(stack.apiUrl + '/api/organizations/active', {
          data: { organizationId: team.id },
        })
      ).status(),
    ).toBe(200);
    const selected = (await (
      await bearer.get(stack.apiUrl + '/api/identity')
    ).json()) as { organization: { id: string } };
    expect(selected.organization.id).toBe(team.id);
    const cookieIdentity = (await (
      await request.get(stack.apiUrl + '/api/identity')
    ).json()) as { organization: { id: string } };
    expect(cookieIdentity.organization.id).toBe(own.organization.id);
    const sessions = await request.get(stack.apiUrl + '/api/identity/sessions');
    const text = await sessions.text();
    expect(text.includes(issued.token)).toBe(false);
    expect(
      (JSON.parse(text) as { id: string; channel: string }[]).some(
        (row) => row.id === issued.sessionId && row.channel === 'bearer',
      ),
    ).toBe(true);
    expect(
      (
        await request.delete(
          stack.apiUrl + '/api/identity/sessions/' + issued.sessionId,
          { headers },
        )
      ).status(),
    ).toBe(204);
    expect((await bearer.get(stack.apiUrl + '/api/identity')).status()).toBe(
      401,
    );
    expect((await request.get(stack.apiUrl + '/api/identity')).status()).toBe(
      200,
    );
  } finally {
    await bearer.dispose();
  }
});
test('production API image contains no test mail or operator control entrypoints', async () => {
  const { docker } = await import('./runtime-support.js');
  const output = await docker([
    'run',
    '--rm',
    '--network',
    'none',
    '--entrypoint',
    'node',
    descriptor().project + '-api',
    '-e',
    "const fs=require('node:fs');const absent=['/app/backend/test','/app/backend/dist/test'].every(p=>!fs.existsSync(p));process.stdout.write(String(absent));",
  ]);
  expect(output).toBe('true');
});
