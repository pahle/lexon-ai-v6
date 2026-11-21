import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  PlatformAccountDetailSchema,
  PlatformAccountsPageSchema,
  PlatformMembersPageSchema,
  PlatformOrganizationDetailSchema,
  PlatformOrganizationsPageSchema,
  AccountInvitationsPageSchema,
} from '@lexon/contracts';
import { descriptor } from './runtime-support.js';
import { authenticateApi } from './identity-support.js';
import { enrollAdministrator } from './brand-visual-platform-world.js';

test.setTimeout(240000);

const pageKeys = ['items', 'page', 'pageSize', 'total'];
const keys = (value: unknown) => Object.keys(value as object).sort();

test('platform console read routes: guards, contract shapes, 404s and query validation', async ({
  page,
  playwright,
}) => {
  const stack = descriptor();
  const api = (path: string) => stack.apiUrl + '/api/platform' + path;
  const origin = { origin: stack.frontendUrl };
  await enrollAdministrator(
    page,
    `console.${Date.now().toString(36)}@example.test`,
  );
  const admin = page.request;
  const anonymous = await playwright.request.newContext();
  const member = await playwright.request.newContext();
  await authenticateApi(member);

  const created = await admin.post(api('/provisioning'), {
    headers: origin,
    data: {
      name: 'Console probe firm',
      slug: `console-${randomUUID().slice(0, 8)}`,
      ownerEmail: `${randomUUID()}@example.test`,
    },
  });
  expect(created.status()).toBe(201);
  const provisioningId = ((await created.json()) as { id: string }).id;

  const accounts = await admin.get(api('/accounts'));
  expect(accounts.status()).toBe(200);
  const accountsBody = PlatformAccountsPageSchema.parse(await accounts.json());
  expect(keys(accountsBody)).toEqual(pageKeys);
  expect(accountsBody.total).toBeGreaterThanOrEqual(2);
  const userId = accountsBody.items[0]!.id;
  const organizations = await admin.get(api('/organizations'));
  expect(organizations.status(), await organizations.text()).toBe(200);
  const organizationsBody = PlatformOrganizationsPageSchema.parse(
    await organizations.json(),
  );
  expect(keys(organizationsBody)).toEqual(pageKeys);
  const orgId =
    organizationsBody.items.find((o) => o.id === provisioningId)?.id ??
    provisioningId;
  const personal = (
    (await (await admin.get(stack.apiUrl + '/api/organizations')).json()) as {
      items: { id: string; kind: string }[];
    }
  ).items.find((o) => o.kind === 'personal')!.id;

  const routes: [string, z.ZodType][] = [
    ['/accounts', PlatformAccountsPageSchema],
    [`/accounts/${userId}`, PlatformAccountDetailSchema],
    ['/account-invitations', AccountInvitationsPageSchema],
    ['/organizations', PlatformOrganizationsPageSchema],
    [`/organizations/${orgId}`, PlatformOrganizationDetailSchema],
    [`/organizations/${orgId}/members`, PlatformMembersPageSchema],
  ];
  for (const [path, schema] of routes) {
    expect((await anonymous.get(api(path))).status(), path).toBe(401);
    expect((await member.get(api(path))).status(), path).toBe(403);
    const ok = await admin.get(api(path));
    expect(ok.status(), path).toBe(200);
    const body = await ok.json();
    expect(schema.safeParse(body).success, path).toBe(true);
    if (
      path.endsWith('/members') ||
      path.endsWith('-invitations') ||
      path.endsWith('/accounts') ||
      path === '/organizations'
    )
      expect(keys(body), path).toEqual(pageKeys);
  }

  const detail = (await (
    await admin.get(api(`/accounts/${userId}`))
  ).json()) as object;
  expect(keys(detail)).toEqual(keys(PlatformAccountDetailSchema.parse(detail)));
  const missing = randomUUID();
  for (const path of [
    `/accounts/${missing}`,
    `/organizations/${missing}`,
    `/organizations/${missing}/members`,
    `/organizations/${personal}`,
    `/organizations/${personal}/members`,
  ]) {
    const response = await admin.get(api(path));
    expect(response.status(), path).toBe(404);
    expect(
      ((await response.json()) as { error: { code: string } }).error.code,
    ).toBe('NOT_FOUND');
  }
  for (const path of ['/accounts?query=a', '/organizations?query=a']) {
    const response = await admin.get(api(path));
    expect(response.status(), path).toBe(400);
    expect(
      ((await response.json()) as { error: { code: string } }).error.code,
    ).toBe('VALIDATION_ERROR');
  }
  const members = await admin.get(
    api(`/organizations/${provisioningId}/members`),
  );
  expect(members.status()).toBe(200);
  expect(await members.json()).toEqual({
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
  });
});

test('revoke signs out cookie and bearer sessions; route guard matrix', async ({
  page,
  playwright,
}) => {
  const stack = descriptor();
  const origin = { origin: stack.frontendUrl };
  await enrollAdministrator(
    page,
    `revoke.${Date.now().toString(36)}@example.test`,
  );
  const admin = page.request;
  const anonymous = await playwright.request.newContext();
  const member = await playwright.request.newContext();
  await authenticateApi(member);
  const target = await playwright.request.newContext();
  const email = `${randomUUID()}@example.test`;
  await authenticateApi(target, { email });
  const userId = (
    (await (
      await target.get(stack.apiUrl + '/api/auth/get-session')
    ).json()) as {
      user: { id: string };
    }
  ).user.id;
  const issued = (await (
    await target.post(stack.apiUrl + '/api/identity/bearer-sessions', {
      headers: origin,
      data: {},
    })
  ).json()) as { token: string };
  const bearer = await playwright.request.newContext({
    extraHTTPHeaders: { authorization: 'Bearer ' + issued.token },
  });
  const url = `${stack.apiUrl}/api/platform/accounts/${userId}/sessions/revoke`;
  expect((await target.get(stack.apiUrl + '/api/identity')).status()).toBe(200);
  expect((await bearer.get(stack.apiUrl + '/api/identity')).status()).toBe(200);
  expect((await anonymous.post(url, { headers: origin })).status()).toBe(401);
  expect((await member.post(url, { headers: origin })).status()).toBe(403);
  const done = await admin.post(url, { headers: origin });
  expect(done.status(), await done.text()).toBe(204);
  await page.waitForTimeout(1100);
  expect((await target.get(stack.apiUrl + '/api/identity')).status()).toBe(401);
  expect((await bearer.get(stack.apiUrl + '/api/identity')).status()).toBe(401);
});

test('verification resend route: 401, 403, 204 for unverified, 409 for verified', async ({
  page,
  playwright,
}) => {
  const stack = descriptor();
  const origin = { origin: stack.frontendUrl };
  await enrollAdministrator(
    page,
    `resend.${Date.now().toString(36)}@example.test`,
  );
  const admin = page.request;
  const anonymous = await playwright.request.newContext();
  const member = await playwright.request.newContext();
  await authenticateApi(member);
  const memberId = (
    (await (
      await member.get(stack.apiUrl + '/api/auth/get-session')
    ).json()) as { user: { id: string } }
  ).user.id;
  const pending = await playwright.request.newContext();
  const email = `${randomUUID()}@example.test`;
  const signup = await pending.post(stack.apiUrl + '/api/auth/sign-up/email', {
    headers: origin,
    data: { name: 'Pending user', email, password: 'E2E-api-identity-42!' },
  });
  expect(signup.status()).toBe(200);
  const found = await admin.get(
    `${stack.apiUrl}/api/platform/accounts?query=${encodeURIComponent(email)}`,
  );
  const pendingId = ((await found.json()) as { items: { id: string }[] })
    .items[0]!.id;
  const path = (id: string) =>
    `${stack.apiUrl}/api/platform/accounts/${id}/verification-email`;
  expect(
    (await anonymous.post(path(pendingId), { headers: origin })).status(),
  ).toBe(401);
  expect(
    (await member.post(path(pendingId), { headers: origin })).status(),
  ).toBe(403);
  const ok = await admin.post(path(pendingId), { headers: origin });
  expect(ok.status(), await ok.text()).toBe(204);
  const verified = await admin.post(path(memberId), { headers: origin });
  expect(verified.status()).toBe(409);
});
