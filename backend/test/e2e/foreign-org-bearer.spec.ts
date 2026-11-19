import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { authenticateApi } from './identity-support.js';
import { descriptor } from './runtime-support.js';

// A-17: a real bearer token of user A against organization B's resources is
// indistinguishable from a missing resource (404), never 403.
test("user A's bearer token gets 404 on organization B's members, chats and settings", async ({
  playwright,
}) => {
  test.setTimeout(90_000);
  const stack = descriptor();
  const userA = await playwright.request.newContext();
  const userB = await playwright.request.newContext();
  let bearer: Awaited<ReturnType<typeof playwright.request.newContext>> | null =
    null;
  try {
    const headersA = await authenticateApi(userA, {
      email: `a-${randomUUID()}@example.test`,
    });
    const headersB = await authenticateApi(userB, {
      email: `b-${randomUUID()}@example.test`,
    });
    const orgB = (
      (await (await userB.get(stack.apiUrl + '/api/identity')).json()) as {
        organization: { id: string };
      }
    ).organization.id;
    expect(
      (
        await userB.post(`${stack.apiUrl}/api/identity/onboarding/complete`, {
          headers: headersB,
          data: {},
        })
      ).status(),
    ).toBe(204);
    const chatB = randomUUID();
    expect(
      (
        await userB.post(`${stack.apiUrl}/api/chats`, {
          headers: headersB,
          data: {
            chatId: chatB,
            userMessageId: randomUUID(),
            requestId: randomUUID(),
            text: 'Organization B private chat.',
            effort: 'high',
          },
        })
      ).status(),
    ).toBe(201);

    const issued = (await (
      await userA.post(stack.apiUrl + '/api/identity/bearer-sessions', {
        headers: headersA,
        data: {},
      })
    ).json()) as { token: string };
    bearer = await playwright.request.newContext({
      extraHTTPHeaders: { authorization: 'Bearer ' + issued.token },
    });
    expect((await bearer.get(stack.apiUrl + '/api/identity')).status()).toBe(
      200,
    );

    const members = await bearer.get(
      `${stack.apiUrl}/api/organizations/${orgB}/members`,
    );
    const chats = await bearer.get(`${stack.apiUrl}/api/chats/${chatB}`);
    const settings = await bearer.patch(
      `${stack.apiUrl}/api/organizations/${orgB}/settings`,
      { data: { name: 'Taken over' } },
    );
    expect([members.status(), chats.status(), settings.status()]).toEqual([
      404, 404, 404,
    ]);
  } finally {
    await Promise.all([bearer?.dispose(), userA.dispose(), userB.dispose()]);
  }
});
