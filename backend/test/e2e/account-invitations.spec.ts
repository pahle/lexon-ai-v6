import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import {
  AccountInvitationSchema,
  AccountInvitationsPageSchema,
} from '@lexon/contracts';
import { descriptor } from './runtime-support.js';
import { authenticateApi, readCapturedMail } from './identity-support.js';
import { enrollAdministrator } from './brand-visual-platform-world.js';

test.setTimeout(240000);

test('account invitation routes: auth matrix, create, mail, list facets, search, resend, cancel', async ({
  page,
  playwright,
}) => {
  const stack = descriptor();
  const api = (path = '') =>
    `${stack.apiUrl}/api/platform/account-invitations${path}`;
  const origin = { origin: stack.frontendUrl };
  await enrollAdministrator(
    page,
    `invites.${Date.now().toString(36)}@example.test`,
  );
  const admin = page.request;
  const anonymous = await playwright.request.newContext();
  const member = await playwright.request.newContext();
  await authenticateApi(member);
  const email = `${randomUUID()}@example.test`;
  const missing = randomUUID();

  for (const [method, path, data] of [
    ['get', ''],
    ['post', '', { email }],
    ['post', `/${missing}/resend`],
    ['delete', `/${missing}`],
  ] as const) {
    const call = (client: typeof admin) =>
      client.fetch(api(path), {
        method,
        headers: origin,
        ...(data ? { data } : {}),
      });
    expect((await call(anonymous)).status(), `${method} ${path}`).toBe(401);
    expect((await call(member)).status(), `${method} ${path}`).toBe(403);
  }

  const created = await admin.post(api(), {
    headers: origin,
    data: { email: email.toUpperCase(), name: 'Invited Person' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const invitation = AccountInvitationSchema.parse(await created.json());
  expect(invitation).toMatchObject({ email, status: 'pending' });
  const mail = await readCapturedMail(
    stack.project,
    email,
    'account-invitation',
  );
  expect(new URL(mail.actionUrl).pathname).toBe('/sign-up');
  expect(
    new URL(mail.actionUrl).searchParams.get('accountInvitation'),
  ).toBeTruthy();

  const duplicate = await admin.post(api(), {
    headers: origin,
    data: { email },
  });
  expect(duplicate.status()).toBe(409);
  expect(await duplicate.json()).toMatchObject({
    error: {
      code: 'PLATFORM_INVITATION_CONFLICT',
      issues: [
        {
          path: 'email',
          message:
            'This address already has a Lexon account or a pending invitation.',
        },
      ],
    },
  });

  const list = async (query: string) =>
    AccountInvitationsPageSchema.parse(
      await (await admin.get(api(`?${query}`))).json(),
    );
  const ids = (p: { items: { id: string }[] }) => p.items.map((i) => i.id);
  expect(ids(await list('status=pending'))).toContain(invitation.id);
  expect(ids(await list('status=expired'))).not.toContain(invitation.id);
  expect(ids(await list(`query=${encodeURIComponent(email)}`))).toEqual([
    invitation.id,
  ]);

  const resent = await admin.post(api(`/${invitation.id}/resend`), {
    headers: origin,
  });
  expect(resent.status(), await resent.text()).toBe(204);
  const cancelled = await admin.delete(api(`/${invitation.id}`), {
    headers: origin,
  });
  expect(cancelled.status(), await cancelled.text()).toBe(204);
  expect(ids(await list(`query=${encodeURIComponent(email)}`))).toEqual([]);
  for (const response of [
    await admin.delete(api(`/${invitation.id}`), { headers: origin }),
    await admin.post(api(`/${invitation.id}/resend`), { headers: origin }),
    await admin.delete(api(`/${missing}`), { headers: origin }),
  ])
    expect(response.status()).toBe(404);
});
