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
/**
 * Waits until React has hydrated the element. The auth forms are plain
 * `method="post"` forms, so a click before hydration is a native navigation
 * that reloads the page with an empty form instead of running the client
 * submit handler. React attaches `__reactProps$*` to an element only when it
 * hydrates it, which also works in the production build (the
 * data-lexon-visual-auth-ready marker only exists under LEXON_VISUAL_DEV).
 */
export async function waitForHydration(
  locator: import('@playwright/test').Locator,
): Promise<void> {
  await expect
    .poll(() =>
      locator.evaluate((element) =>
        Object.keys(element).some((key) => key.startsWith('__reactProps$')),
      ),
    )
    .toBe(true);
}
export async function authenticateApi(
  request: import('@playwright/test').APIRequestContext,
  fixture: { name?: string; email?: string; password?: string } = {},
): Promise<Record<string, string>> {
  const { descriptor } = await import('./runtime-support.js');
  const { randomUUID } = await import('node:crypto');
  const stack = descriptor();
  const name = fixture.name ?? 'E2E identity';
  const email = fixture.email ?? `${randomUUID()}@example.test`;
  const password = fixture.password ?? 'E2E-api-identity-42!';
  const headers = { origin: stack.frontendUrl };
  expect(
    (
      await request.post(stack.apiUrl + '/api/auth/sign-up/email', {
        headers,
        data: { name, email, password },
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
