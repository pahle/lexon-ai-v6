// F4.3 platform console in the browser: the brief's user flows 1 to 9, the
// account invitation lifecycle, and axe in both themes on every console page.
// The stack is shared and long-lived: every address, name, and slug is unique
// to the run, and lists are always searched for those values.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { containerId, descriptor, docker } from './runtime-support.js';
import {
  authenticateApi,
  readCapturedMail,
  waitForHydration,
} from './identity-support.js';
import { withSignupMode } from './setup-support.js';
import { enrollAdministrator } from './brand-visual-platform-world.js';
import { platformAdmin } from './prototype-fixtures.js';
import { totpForUri } from '../setup/totp.js';

test.setTimeout(300000);

const password = 'Console-browser-42!';
const unique = () => randomUUID().slice(0, 8);
const address = (label: string) => `${label}.${randomUUID()}@example.test`;

const psql = async (sql: string) =>
  docker([
    'exec',
    await containerId('postgres'),
    'sh',
    '-c',
    'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -U postgres -d lexon -v ON_ERROR_STOP=1 -At -c "$0"',
    sql,
  ]);

/** Waits for running CSS transitions and animations (theme, dialog fade). */
const settle = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().endTime !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );

/** Axe in light and dark on the page as it is (dialogs stay open). */
async function axeBothThemes(page: Page, label: string) {
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.evaluate((value) => {
      localStorage.setItem('theme', value);
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'theme',
          newValue: value,
          storageArea: localStorage,
        }),
      );
    }, theme);
    await expect(page.locator('html')).toHaveClass(
      theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/,
    );
    await settle(page);
    expect(
      (await new AxeBuilder({ page }).analyze()).violations,
      `${theme} ${label}`,
    ).toEqual([]);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => {
    localStorage.setItem('theme', 'light');
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'theme',
        newValue: 'light',
        storageArea: localStorage,
      }),
    );
  });
}

const toast = (page: Page, text: string) =>
  page.locator('[data-sonner-toast]').filter({ hasText: text }).first();
const tile = (page: Page, label: string) =>
  page
    .locator('[data-slot="stat-tile"]')
    .filter({ hasText: label })
    .locator('b');
const mainText = (page: Page, text: string) =>
  page
    .getByRole('main')
    .getByText(text, { exact: true })
    .filter({ visible: true })
    .first();
const responseTo = (page: Page, method: string, path: RegExp) =>
  page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      path.test(new URL(response.url()).pathname),
  );

async function search(page: Page, label: string, value: string) {
  const box = page.getByLabel(label, { exact: true });
  await waitForHydration(box);
  await box.fill(value);
  // The query reaches the URL after a debounce; a row clicked before that
  // navigation would be replaced by it.
  await expect
    .poll(() => new URL(page.url()).searchParams.get('query'))
    .toBe(value);
}

/** Opens one account record from the Accounts list by a unique search. */
async function openAccount(page: Page, query: string, name: string) {
  const stack = descriptor();
  await page.goto(stack.frontendUrl + '/platform/accounts');
  await expect(page.locator('h1')).toHaveText('Accounts');
  await search(page, 'Search by name or email', query);
  const row = page.getByLabel(`Open ${name}`, { exact: true });
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(page).toHaveURL(/\/platform\/accounts\/[0-9a-f-]{36}$/);
  await expect(page.locator('h1')).toHaveText(name);
}

async function provisionThroughDialog(
  page: Page,
  input: { name: string; slug: string; ownerEmail: string },
  axe = false,
) {
  const open = page.getByRole('button', {
    name: 'Provision organization',
    exact: true,
  });
  await waitForHydration(open);
  await open.click();
  const dialog = page.getByRole('dialog', {
    name: 'Provision a team organization',
  });
  await expect(dialog).toBeVisible();
  if (axe) await axeBothThemes(page, 'provision dialog');
  await dialog
    .getByLabel('Organization name', { exact: true })
    .fill(input.name);
  await dialog
    .getByLabel('Organization slug', { exact: true })
    .fill(input.slug);
  await dialog
    .getByLabel('First owner email', { exact: true })
    .fill(input.ownerEmail);
  const created = responseTo(page, 'POST', /^\/api\/platform\/provisioning$/);
  await dialog
    .getByRole('button', { name: 'Provision organization', exact: true })
    .click();
  const response = await created;
  expect(response.status()).toBe(201);
  const id = ((await response.json()) as { id: string }).id;
  await expect(page).toHaveURL(new RegExp(`/platform/organizations/${id}$`));
  await expect(page.locator('h1')).toHaveText(input.name);
  return id;
}

test('accounts and active organizations: find, team link, self-protection, audited members, failure rows, axe', async ({
  page,
  playwright,
}) => {
  const started = Date.now();
  const stack = descriptor();
  const origin = { origin: stack.frontendUrl };
  const adminEmail = address('console.browser');
  await enrollAdministrator(page, adminEmail);
  const adminId = (
    (await (
      await page.request.get(stack.apiUrl + '/api/auth/get-session')
    ).json()) as { user: { id: string } }
  ).user.id;
  const tag = unique();
  // Platform administrators cannot create teams: the account of flow 1 is a
  // member with two teams and an authenticator.
  const memberName = `Member person ${tag}`;
  const memberEmail = address('console.member');
  const member = await playwright.request.newContext();
  await authenticateApi(member, {
    name: memberName,
    email: memberEmail,
    password,
  });
  const teams: { name: string; id: string }[] = [];
  for (const prefix of ['Alpha', 'Beta']) {
    const name = `${prefix} chambers ${tag}`;
    const created = await member.post(stack.apiUrl + '/api/organizations', {
      headers: origin,
      data: { name, slug: `${prefix.toLowerCase()}-${tag}` },
    });
    expect(created.status(), await created.text()).toBe(201);
    teams.push({ name, id: ((await created.json()) as { id: string }).id });
  }
  const enabled = await member.post(
    stack.apiUrl + '/api/auth/two-factor/enable',
    {
      headers: origin,
      data: { password },
    },
  );
  expect(enabled.status(), await enabled.text()).toBe(200);
  const totpURI = ((await enabled.json()) as { totpURI: string }).totpURI;
  const verified = await member.post(
    stack.apiUrl + '/api/auth/two-factor/verify-totp',
    { headers: origin, data: { code: totpForUri(totpURI) } },
  );
  expect(verified.status(), await verified.text()).toBe(200);
  await member.dispose();
  const alpha = teams[0]!;

  await test.step('flow 1: find an account by part of its email and follow a team', async () => {
    await openAccount(page, memberEmail.split('@')[0]!.slice(-12), memberName);
    await expect(mainText(page, 'Active')).toBeVisible();
    await expect(tile(page, 'Two-step verification')).toHaveText('On');
    await expect(tile(page, 'Teams')).toHaveText('2');
    for (const team of teams)
      await expect(
        page.getByRole('link', { name: `Open ${team.name}`, exact: true }),
      ).toBeVisible();
    await axeBothThemes(page, 'account record (active)');
  });

  await test.step('flow 7: the active organization shows facts and members; the view is audited', async () => {
    await page
      .getByRole('link', { name: `Open ${alpha.name}`, exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(`/platform/organizations/${alpha.id}$`),
    );
    await expect(page.locator('h1')).toHaveText(alpha.name);
    await expect(mainText(page, 'Active')).toBeVisible();
    await expect(tile(page, 'Members')).toHaveText('1');
    await expect(tile(page, 'Two-step verification')).toHaveText(
      'Not required',
    );
    await expect(mainText(page, `alpha-${tag}`)).toBeVisible();
    // The members card is full width (LEX-DS-001 §5.7), so members are table rows.
    const memberRow = page.getByRole('row').filter({ hasText: memberEmail });
    await expect(memberRow).toHaveCount(1);
    await expect(memberRow).toContainText(memberName);
    await expect(memberRow).toContainText('Owner');
    await expect
      .poll(() =>
        psql(
          `SELECT string_agg(DISTINCT metadata::text, ',') FROM ops.audit_events WHERE type='platform.organization_members_viewed.v1' AND org_id='${alpha.id}'`,
        ),
      )
      .toBe('{"page": 1}');
    await axeBothThemes(page, 'organization record (active)');
  });

  await test.step('flow 5: no self-disable or self-sign-out; the API refuses both', async () => {
    await openAccount(
      page,
      adminEmail.split('@')[0]!.slice(-12),
      platformAdmin.name,
    );
    await expect(page).toHaveURL(new RegExp(`/platform/accounts/${adminId}$`));
    await expect(mainText(page, 'Platform administrator')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Disable account', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Sign out everywhere', exact: true }),
    ).toHaveCount(0);
    await axeBothThemes(page, 'account record (self)');
    const disable = await page.request.patch(
      `${stack.apiUrl}/api/platform/users/${adminId}/disabled`,
      { headers: origin, data: { disabled: true } },
    );
    expect(disable.status()).toBe(409);
    expect(
      ((await disable.json()) as { error: { code: string } }).error.code,
    ).toBe('PLATFORM_SELF_ACTION');
    const revoke = await page.request.post(
      `${stack.apiUrl}/api/platform/accounts/${adminId}/sessions/revoke`,
      { headers: origin },
    );
    expect(revoke.status()).toBe(409);
    expect(
      ((await revoke.json()) as { error: { code: string } }).error.code,
    ).toBe('PLATFORM_SELF_ACTION');
  });

  await test.step('flow 8: failed list and detail fetches show the error row with Try again', async () => {
    let failAccounts = true;
    await page.route(
      (url) => url.pathname === '/api/platform/accounts',
      (route) =>
        failAccounts
          ? route.fulfill({ status: 503, body: '' })
          : route.continue(),
    );
    await page.goto(stack.frontendUrl + '/platform/accounts');
    const accountsFailure = page
      .getByRole('alert')
      .filter({ hasText: 'We could not load accounts.' });
    await expect(accountsFailure).toBeVisible();
    await expect(
      page.getByText('No accounts yet', { exact: true }),
    ).toHaveCount(0);
    failAccounts = false;
    await accountsFailure
      .getByRole('button', { name: 'Try again', exact: true })
      .click();
    await expect(accountsFailure).toHaveCount(0);
    await expect(page.locator('[data-slot="data-table"]')).toBeVisible();
    await axeBothThemes(page, 'accounts list');

    let failDetail = true;
    await page.route(
      (url) => url.pathname === `/api/platform/organizations/${alpha.id}`,
      (route) =>
        failDetail
          ? route.fulfill({ status: 503, body: '' })
          : route.continue(),
    );
    await page.goto(stack.frontendUrl + `/platform/organizations/${alpha.id}`);
    const detailFailure = page
      .getByRole('alert')
      .filter({ hasText: 'We could not load this organization.' });
    await expect(detailFailure).toBeVisible();
    await expect(
      page.getByText('Organization not found', { exact: true }),
    ).toHaveCount(0);
    failDetail = false;
    await detailFailure
      .getByRole('button', { name: 'Try again', exact: true })
      .click();
    await expect(page.locator('h1')).toHaveText(alpha.name);
    await expect(detailFailure).toHaveCount(0);
    await page.unrouteAll();
  });
  console.info(
    `[platform-console-browser] accounts: ${Date.now() - started}ms`,
  );
});

test('account support: verification resend limit, sign out everywhere, disable and enable', async ({
  page,
  browser,
  playwright,
}) => {
  const started = Date.now();
  const stack = descriptor();
  const origin = { origin: stack.frontendUrl };
  await enrollAdministrator(page, address('console.support'));
  const tag = unique();

  await test.step('flow 2: support an unverified user; the fourth resend is refused', async () => {
    const pendingName = `Pending person ${tag}`;
    const pendingEmail = address('console.pending');
    const client = await playwright.request.newContext();
    const signup = await client.post(stack.apiUrl + '/api/auth/sign-up/email', {
      headers: origin,
      data: { name: pendingName, email: pendingEmail, password },
    });
    expect(signup.status()).toBe(200);
    await client.dispose();
    await openAccount(page, pendingEmail, pendingName);
    await expect(mainText(page, 'Unverified')).toBeVisible();
    await axeBothThemes(page, 'account record (unverified)');
    const resend = page.getByRole('button', {
      name: 'Resend verification email',
      exact: true,
    });
    for (const expected of [204, 204, 204]) {
      await expect(resend).toBeEnabled();
      const response = responseTo(page, 'POST', /\/verification-email$/);
      await resend.click();
      expect((await response).status()).toBe(expected);
      await expect(
        toast(page, `Verification email sent to ${pendingEmail}.`),
      ).toBeVisible();
    }
    await expect(resend).toBeEnabled();
    const limited = responseTo(page, 'POST', /\/verification-email$/);
    await resend.click();
    const refused = await limited;
    expect(refused.status()).toBe(429);
    expect(
      ((await refused.json()) as { error: { code: string } }).error.code,
    ).toBe('AUTH_RATE_LIMITED');
    await expect(
      toast(page, 'Too many requests. Wait a moment and try again.'),
    ).toBeVisible();
  });

  const targetName = `Target person ${tag}`;
  const targetEmail = address('console.target');
  const target = await browser.newContext();
  try {
    await authenticateApi(target.request, {
      name: targetName,
      email: targetEmail,
      password,
    });
    const identity = () => target.request.get(stack.apiUrl + '/api/identity');
    const signIn = () =>
      target.request.post(stack.apiUrl + '/api/auth/sign-in/email', {
        headers: origin,
        data: { email: targetEmail, password },
      });

    await test.step('flow 3: sign a compromised account out everywhere', async () => {
      expect((await identity()).status()).toBe(200);
      await openAccount(page, targetEmail, targetName);
      await expect(mainText(page, 'Active')).toBeVisible();
      await expect(tile(page, 'Active sessions')).toHaveText('1');
      await page
        .getByRole('button', { name: 'Sign out everywhere', exact: true })
        .click();
      const dialog = page.getByRole('alertdialog', {
        name: `Sign ${targetName} out everywhere?`,
      });
      await expect(dialog).toBeVisible();
      await axeBothThemes(page, 'sign out everywhere confirmation');
      const revoked = responseTo(page, 'POST', /\/sessions\/revoke$/);
      await dialog
        .getByRole('button', { name: 'Sign out everywhere', exact: true })
        .click();
      expect((await revoked).status()).toBe(204);
      await expect(
        toast(page, `${targetName} was signed out everywhere.`),
      ).toBeVisible();
      await expect(tile(page, 'Active sessions')).toHaveText('0');
      // The revalidation TTL is 1 s.
      await page.waitForTimeout(1100);
      expect((await identity()).status()).toBe(401);
    });

    await test.step('flow 4: disable names the person and ends sessions; enable restores sign-in', async () => {
      expect((await signIn()).status()).toBe(200);
      await page.reload();
      await expect(tile(page, 'Active sessions')).toHaveText('1');
      await page
        .getByRole('button', { name: 'Disable account', exact: true })
        .click();
      const dialog = page.getByRole('alertdialog', {
        name: `Disable ${targetName}?`,
      });
      await expect(dialog).toBeVisible();
      await axeBothThemes(page, 'disable confirmation');
      const disabled = responseTo(page, 'PATCH', /\/disabled$/);
      await dialog
        .getByRole('button', { name: 'Disable account', exact: true })
        .click();
      expect((await disabled).status()).toBe(204);
      await expect(toast(page, 'Account disabled.')).toBeVisible();
      await expect(mainText(page, 'Disabled')).toBeVisible();
      await expect(tile(page, 'Active sessions')).toHaveText('0');
      await axeBothThemes(page, 'account record (disabled)');
      const enabled = responseTo(page, 'PATCH', /\/disabled$/);
      await page
        .getByRole('button', { name: 'Enable account', exact: true })
        .click();
      expect((await enabled).status()).toBe(204);
      await expect(toast(page, 'Account enabled.')).toBeVisible();
      await expect(mainText(page, 'Active')).toBeVisible();
      expect((await signIn()).status()).toBe(200);
      expect((await identity()).status()).toBe(200);
    });
  } finally {
    await target.close();
  }
  console.info(`[platform-console-browser] support: ${Date.now() - started}ms`);
});

test('organizations: provision, resend, replace owner, owner accepts, cancel, axe', async ({
  page,
  browser,
}) => {
  const started = Date.now();
  const stack = descriptor();
  await enrollAdministrator(page, address('console.provision'));
  const tag = unique();
  const harbor = {
    name: `Harbor counsel ${tag}`,
    slug: `harbor-${tag}`,
    ownerEmail: address('console.owner'),
  };
  const replacementEmail = address('console.replacement');
  let harborId = '';

  await test.step('flow 6: provision through the dialog; the row shows Provisioning', async () => {
    await page.goto(stack.frontendUrl + '/platform/organizations');
    await expect(page.locator('h1')).toHaveText('Organizations');
    await axeBothThemes(page, 'organizations list');
    harborId = await provisionThroughDialog(page, harbor, true);
    await axeBothThemes(page, 'organization record (provisioning)');
    await page.goto(stack.frontendUrl + '/platform/organizations');
    await search(page, 'Search by name or slug', harbor.slug);
    const row = page.getByLabel(`Open ${harbor.name}`, { exact: true });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('cell').nth(1)).toHaveText('Provisioning');
    await row.click();
    await expect(page).toHaveURL(
      new RegExp(`/platform/organizations/${harborId}$`),
    );
  });

  await test.step('flow 6: resend and replace the owner email', async () => {
    const resent = responseTo(
      page,
      'POST',
      new RegExp(`/api/platform/provisioning/${harborId}/resend$`),
    );
    await page
      .getByRole('button', { name: 'Resend invitation', exact: true })
      .click();
    expect((await resent).status()).toBe(200);
    await expect(toast(page, 'Owner invitation resent.')).toBeVisible();
    const replaceBox = page.getByLabel('New owner email', { exact: true });
    await waitForHydration(replaceBox);
    await replaceBox.fill(replacementEmail);
    const replaced = responseTo(page, 'PATCH', /\/owner-email$/);
    await page
      .getByRole('button', { name: 'Replace and send', exact: true })
      .click();
    expect((await replaced).status()).toBe(200);
    await expect(toast(page, 'Owner invitation updated.')).toBeVisible();
    await expect(mainText(page, replacementEmail)).toBeVisible();
  });

  await test.step('flow 6: the invited owner accepts; the row shows Active with 1 member', async () => {
    const context = await browser.newContext();
    try {
      const owner = await context.newPage();
      await owner.goto(
        (await readCapturedMail(stack.project, replacementEmail, 'invitation'))
          .actionUrl,
      );
      await owner
        .getByRole('link', { name: 'create an account', exact: true })
        .click();
      await waitForHydration(
        owner.getByRole('button', { name: 'Create account', exact: true }),
      );
      await owner.getByLabel('Full name', { exact: true }).fill('First owner');
      await owner
        .getByLabel('Work email', { exact: true })
        .fill(replacementEmail);
      await owner.getByLabel('Password', { exact: true }).fill(password);
      await owner
        .getByRole('button', { name: 'Create account', exact: true })
        .click();
      await expect(
        owner.getByRole('heading', { name: 'Verify your email' }),
      ).toBeVisible();
      await owner.goto(
        (
          await readCapturedMail(
            stack.project,
            replacementEmail,
            'verification',
          )
        ).actionUrl,
      );
      await owner.getByRole('link', { name: 'Sign in', exact: true }).click();
      await waitForHydration(
        owner.getByRole('button', { name: 'Sign in', exact: true }),
      );
      await owner.getByLabel('Email', { exact: true }).fill(replacementEmail);
      await owner.getByLabel('Password', { exact: true }).fill(password);
      await owner.getByRole('button', { name: 'Sign in', exact: true }).click();
      const accepted = owner.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          /\/api\/invitations\/[^/]+\/accept$/.test(
            new URL(response.url()).pathname,
          ),
      );
      await owner
        .getByRole('button', { name: 'Accept invitation', exact: true })
        .click();
      expect((await accepted).status()).toBe(200);
      await expect(owner).toHaveURL(/\/(workspace|onboarding)/);
    } finally {
      await context.close();
    }
    await page.goto(stack.frontendUrl + '/platform/organizations');
    await search(page, 'Search by name or slug', harbor.slug);
    const row = page.getByLabel(`Open ${harbor.name}`, { exact: true });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('cell').nth(1)).toHaveText('Active');
    await expect(row.getByRole('cell').nth(2)).toHaveText('1');
  });

  await test.step('flow 6: cancel a second provisioned organization', async () => {
    const ferry = {
      name: `Ferry counsel ${tag}`,
      slug: `ferry-${tag}`,
      ownerEmail: address('console.ferry'),
    };
    await page.goto(stack.frontendUrl + '/platform/organizations');
    const ferryId = await provisionThroughDialog(page, ferry);
    await page
      .getByRole('button', { name: 'Cancel provisioning', exact: true })
      .click();
    const dialog = page.getByRole('alertdialog', {
      name: `Cancel provisioning for ${ferry.name}?`,
    });
    await expect(dialog).toBeVisible();
    await axeBothThemes(page, 'cancel provisioning confirmation');
    const cancelled = responseTo(
      page,
      'DELETE',
      new RegExp(`/api/platform/provisioning/${ferryId}$`),
    );
    await dialog
      .getByRole('button', { name: 'Cancel provisioning', exact: true })
      .click();
    expect((await cancelled).status()).toBe(204);
    await expect(toast(page, 'Provisioning cancelled.')).toBeVisible();
    await expect(page).toHaveURL(/\/platform\/organizations$/);
    await search(page, 'Search by name or slug', ferry.slug);
    await expect(
      page.getByText(/No organizations match/).first(),
    ).toBeVisible();
    await expect(
      page.getByLabel(`Open ${ferry.name}`, { exact: true }),
    ).toHaveCount(0);
  });
  console.info(
    `[platform-console-browser] organizations: ${Date.now() - started}ms`,
  );
});

test('account invitations: invite, resend, cancel, and accept with public sign-up closed', async ({
  page,
  browser,
}) => {
  const started = Date.now();
  const stack = descriptor();
  await enrollAdministrator(page, address('console.invites'));
  const tag = unique();
  const invitee = { email: address('console.invitee'), name: `Invitee ${tag}` };
  const dropped = address('console.dropped');

  const invite = async (email: string, name: string, axe = false) => {
    const open = page.getByRole('button', {
      name: 'Invite account',
      exact: true,
    });
    await waitForHydration(open);
    await open.click();
    const dialog = page.getByRole('dialog', {
      name: 'Invite someone to Lexon',
    });
    await expect(dialog).toBeVisible();
    if (axe) await axeBothThemes(page, 'invite dialog');
    await dialog.getByLabel('Email', { exact: true }).fill(email);
    await dialog.getByLabel('Name', { exact: true }).fill(name);
    const created = responseTo(
      page,
      'POST',
      /^\/api\/platform\/account-invitations$/,
    );
    await dialog
      .getByRole('button', { name: 'Send invitation', exact: true })
      .click();
    const response = await created;
    expect(response.status()).toBe(201);
    await expect(toast(page, `Invitation sent to ${email}.`)).toBeVisible();
    await expect(dialog).toHaveCount(0);
    return ((await response.json()) as { id: string }).id;
  };
  const invitationRow = (email: string) =>
    page.getByRole('row').filter({ hasText: email });

  await test.step('invite: the dialog sends and the row appears under Invitations', async () => {
    await page.goto(stack.frontendUrl + '/platform/accounts');
    await expect(page.locator('h1')).toHaveText('Accounts');
    await invite(invitee.email, invitee.name, true);
    await page.getByRole('tab', { name: /^Invitations/ }).click();
    await expect(page).toHaveURL(/\/platform\/accounts\?tab=invitations$/);
    await search(page, 'Search by name or email', invitee.email);
    await expect(invitationRow(invitee.email)).toHaveCount(1);
    await expect(invitationRow(invitee.email)).toContainText('Pending');
    await expect(invitationRow(invitee.email)).toContainText(invitee.name);
    await axeBothThemes(page, 'invitations tab');
  });

  await test.step('resend: the row menu resends and a toast confirms', async () => {
    await page
      .getByRole('button', {
        name: `Actions for ${invitee.email}`,
        exact: true,
      })
      .click();
    const resent = responseTo(
      page,
      'POST',
      /^\/api\/platform\/account-invitations\/[^/]+\/resend$/,
    );
    await page
      .getByRole('menuitem', { name: 'Resend invitation', exact: true })
      .click();
    expect((await resent).status()).toBe(204);
    await expect(
      toast(page, `Invitation resent to ${invitee.email}.`),
    ).toBeVisible();
  });

  await test.step('cancel: the confirmation names the address and the row leaves', async () => {
    await invite(dropped, `Dropped ${tag}`);
    await search(page, 'Search by name or email', dropped);
    await expect(invitationRow(dropped)).toHaveCount(1);
    await page
      .getByRole('button', { name: `Actions for ${dropped}`, exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Cancel invitation', exact: true })
      .click();
    const dialog = page.getByRole('alertdialog', {
      name: `Cancel the invitation to ${dropped}?`,
    });
    await expect(dialog).toBeVisible();
    const cancelled = responseTo(
      page,
      'DELETE',
      /^\/api\/platform\/account-invitations\/[^/]+$/,
    );
    await dialog
      .getByRole('button', { name: 'Cancel invitation', exact: true })
      .click();
    expect((await cancelled).status()).toBe(204);
    await expect(
      toast(page, `Invitation to ${dropped} canceled.`),
    ).toBeVisible();
    await expect(invitationRow(dropped)).toHaveCount(0);
  });

  await test.step('accept: the invitee signs up from the emailed link with public sign-up closed', async () => {
    // The API keeps captured mail in memory: read it before the mode switch
    // recreates the container.
    const mail = await readCapturedMail(
      stack.project,
      invitee.email,
      'account-invitation',
    );
    const token = new URL(mail.actionUrl).searchParams.get('accountInvitation');
    expect(token).toBeTruthy();
    const context = await browser.newContext();
    try {
      const visitor = await context.newPage();
      await withSignupMode(false, async () => {
        await visitor.goto(
          `${stack.frontendUrl}/sign-up?accountInvitation=${encodeURIComponent(token!)}`,
        );
        await waitForHydration(
          visitor.getByRole('button', { name: 'Create account', exact: true }),
        );
        await visitor
          .getByLabel('Full name', { exact: true })
          .fill(invitee.name);
        await visitor
          .getByLabel('Work email', { exact: true })
          .fill(invitee.email);
        await visitor.getByLabel('Password', { exact: true }).fill(password);
        const signedUp = visitor.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/api/auth/sign-up/email' &&
            response.request().method() === 'POST',
        );
        await visitor
          .getByRole('button', { name: 'Create account', exact: true })
          .click();
        expect((await signedUp).status()).toBe(200);
        await expect(visitor).toHaveURL(/\/sign-in(\?|$)/);
        await waitForHydration(
          visitor.getByRole('button', { name: 'Sign in', exact: true }),
        );
        await visitor.getByLabel('Email', { exact: true }).fill(invitee.email);
        await visitor.getByLabel('Password', { exact: true }).fill(password);
        const signedIn = visitor.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/api/auth/sign-in/email' &&
            response.request().method() === 'POST',
        );
        await visitor
          .getByRole('button', { name: 'Sign in', exact: true })
          .click();
        expect((await signedIn).status()).toBe(200);
        await expect(visitor).toHaveURL(/\/(workspace|onboarding)/);
      });
    } finally {
      await context.close();
    }
    await page.goto(stack.frontendUrl + '/platform/accounts?tab=invitations');
    await search(page, 'Search by name or email', invitee.email);
    await expect(page.getByText(/No invitations match/).first()).toBeVisible();
    await expect(invitationRow(invitee.email)).toHaveCount(0);
  });
  console.info(
    `[platform-console-browser] invitations: ${Date.now() - started}ms`,
  );
});

test('flow 9: a member sees the no-access page and the API answers 403', async ({
  page,
}) => {
  const stack = descriptor();
  const headers = await authenticateApi(page.request);
  expect(
    (
      await page.request.post(
        stack.apiUrl + '/api/identity/onboarding/complete',
        { headers, data: {} },
      )
    ).status(),
  ).toBe(204);
  for (const path of [
    '/platform/accounts',
    `/platform/organizations/${randomUUID()}`,
  ]) {
    await page.goto(stack.frontendUrl + path);
    await expect(page.locator('section[role="alert"]')).toContainText(
      'You do not have access',
    );
  }
  for (const path of ['/accounts', '/organizations']) {
    const response = await page.request.get(
      `${stack.apiUrl}/api/platform${path}`,
    );
    expect(response.status(), path).toBe(403);
    expect(
      ((await response.json()) as { error: { code: string } }).error.code,
      path,
    ).toBe('ORG_FORBIDDEN');
  }
});
