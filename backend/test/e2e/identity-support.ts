import { expect } from '@playwright/test';
import { containerId, docker } from './runtime-support.js';
export interface CapturedMail {
  to: string;
  kind: string;
  actionUrl: string;
}
export async function readCapturedMail(
  _project: string,
  recipient: string,
  kind: string,
): Promise<CapturedMail> {
  let captured: CapturedMail | null = null;
  await expect
    .poll(
      async () => {
        const result = await docker([
          'exec',
          await containerId('api'),
          'node',
          'backend/test/e2e/mail-control.mjs',
          recipient,
          kind,
        ]);
        captured = JSON.parse(result) as CapturedMail | null;
        return captured !== null;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  if (!captured) throw new Error('Expected test mail');
  return captured;
}
export async function authenticateApi(
  request: import('@playwright/test').APIRequestContext,
): Promise<Record<string, string>> {
  const { descriptor } = await import('./runtime-support.js');
  const { randomUUID } = await import('node:crypto');
  const stack = descriptor();
  const email = `${randomUUID()}@example.test`;
  const password = 'E2E-api-identity-42!';
  const headers = { origin: stack.frontendUrl };
  expect(
    (
      await request.post(stack.apiUrl + '/api/auth/sign-up/email', {
        headers,
        data: { name: 'E2E identity', email, password },
      })
    ).status(),
  ).toBe(200);
  const mail = await readCapturedMail(stack.project, email, 'verification');
  const url = new URL(mail.actionUrl);
  url.searchParams.delete('callbackURL');
  expect(
    (await request.get(stack.apiUrl + url.pathname + url.search)).status(),
  ).toBe(200);
  expect(
    (
      await request.post(stack.apiUrl + '/api/auth/sign-in/email', {
        headers,
        data: { email, password },
      })
    ).status(),
  ).toBe(200);
  return headers;
}
