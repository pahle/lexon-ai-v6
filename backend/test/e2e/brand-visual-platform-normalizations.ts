// The prototype's platform console content (revision 16) on the real API.
// Every GET is sent to the stack first; a failed response is passed through
// unchanged, so a broken route still fails the capture. A successful body is
// then rewritten to the prototype rows (prototype-fixtures.ts) the way the
// other visual normalizations are: the suite shares one stack, so the real
// lists hold every account and organization other specs created, and the
// dates, counts, and ids are the run's own. Rows the captures open keep real
// ids (the record request must reach a real record); record pages show the
// prototype's ids. Each rewritten body is parsed with its strict contract, so
// a normalization can never show what the API could not send.
import type { Page, Route } from '@playwright/test';
import {
  AccountInvitationsPageSchema,
  PlatformAccountDetailSchema,
  PlatformAccountsPageSchema,
  PlatformMembersPageSchema,
  PlatformOrganizationDetailSchema,
  PlatformOrganizationsPageSchema,
} from '@lexon/contracts';
import { orderExactCaptureRows } from '../../../scripts/test/visual-capture-normalizations.mjs';
import type { PlatformWorld } from './brand-visual-platform-world.js';
import {
  platformAccountRecords,
  platformAccounts,
  platformAccountsTotal,
  platformActiveOrganization,
  platformInvitations,
  platformOrganizations,
  platformProvisioningOrganization,
} from './prototype-fixtures.js';

/** Rows the captures never open get a fixed id (strict uuid, never on screen). */
const fixedId = (index: number) =>
  `00000000-0000-4000-8000-${String(1600 + index).padStart(12, '0')}`;

const paging = (url: URL) => ({
  page: Number(url.searchParams.get('page') ?? '1'),
  pageSize: Number(url.searchParams.get('pageSize') ?? '20'),
});

function slice<T>(rows: readonly T[], url: URL) {
  const { page, pageSize } = paging(url);
  return rows.slice((page - 1) * pageSize, page * pageSize);
}

const contains = (query: string | null, ...values: string[]) =>
  !query ||
  values.some((value) => value.toLowerCase().includes(query.toLowerCase()));

function accountsPage(url: URL, world: PlatformWorld) {
  const query = url.searchParams.get('query');
  const status = url.searchParams.getAll('status');
  const twoFactor = url.searchParams.getAll('twoFactor');
  const filtered = Boolean(query || status.length || twoFactor.length);
  const rows = platformAccounts
    .map((account, index) => ({ account, index }))
    .filter(
      ({ account }) =>
        contains(query, account.name, account.email) &&
        (!status.length || status.includes(account.status)) &&
        (!twoFactor.length ||
          twoFactor.includes(account.twoFactor ? 'on' : 'off')),
    );
  return PlatformAccountsPageSchema.parse({
    ...paging(url),
    total: filtered ? rows.length : platformAccountsTotal,
    items: slice(rows, url).map(({ account, index }) => ({
      id:
        account.key in world.accounts
          ? world.accounts[account.key as keyof PlatformWorld['accounts']]
          : fixedId(index),
      name: account.name,
      email: account.email,
      status: account.status,
      twoFactorEnabled: account.twoFactor,
      isPlatformAdministrator: 'admin' in account && account.admin,
      teamCount: account.teams,
      createdAt: account.joined,
      lastActiveAt: account.lastActive,
    })),
  });
}

function accountDetail(
  real: Record<string, unknown>,
  key: keyof typeof platformAccountRecords,
  world: PlatformWorld,
) {
  const account = platformAccounts.find((row) => row.key === key)!;
  const record = platformAccountRecords[key];
  // The status is the real one (an unverified sign-up, a disabled account).
  if (real.status !== account.status)
    throw new Error(
      `${account.name} is ${String(real.status)} on the stack, not ${account.status}`,
    );
  return PlatformAccountDetailSchema.parse({
    ...real,
    id: record.id,
    name: account.name,
    email: account.email,
    twoFactorEnabled: account.twoFactor,
    isPlatformAdministrator: false,
    teamCount: record.teams.length,
    createdAt: account.joined,
    lastActiveAt: account.lastActive,
    emailVerified: account.status !== 'unverified',
    activeSessionCount: record.sessions,
    teams: record.teams.map((team) => {
      const organization = platformOrganizations.find(
        (row) => row.key === team.organization,
      )!;
      return {
        organizationId: world.organizations[team.organization]!,
        name: organization.name,
        slug: organization.slug,
        role: team.role,
      };
    }),
  });
}

function organizationsPage(url: URL, world: PlatformWorld) {
  const query = url.searchParams.get('query');
  const state = url.searchParams.getAll('state');
  const rows = platformOrganizations.filter(
    (organization) =>
      contains(query, organization.name, organization.slug) &&
      (!state.length || state.includes(organization.state)),
  );
  return PlatformOrganizationsPageSchema.parse({
    ...paging(url),
    total: rows.length,
    items: slice(rows, url).map((organization) => ({
      id: world.organizations[organization.key]!,
      name: organization.name,
      slug: organization.slug,
      state: organization.state,
      memberCount: organization.members,
      ownerEmail: organization.ownerEmail,
      createdAt: organization.createdAt,
    })),
  });
}

function invitationsPage(url: URL) {
  const query = url.searchParams.get('query');
  const status = url.searchParams.getAll('status');
  const rows = platformInvitations.filter(
    (invitation) =>
      contains(query, invitation.name ?? '', invitation.email) &&
      (!status.length || status.includes(invitation.status)),
  );
  return AccountInvitationsPageSchema.parse({
    ...paging(url),
    total: rows.length,
    items: slice(rows, url),
  });
}

/**
 * Installs the platform console normalizations on the page. `remove()`
 * waits for every rewrite in flight and rethrows the first one that failed.
 */
export async function installPlatformConsoleNormalization(
  page: Page,
  world: PlatformWorld,
) {
  const pending = new Set<Promise<void>>();
  const failures: unknown[] = [];
  const accountKeys = new Map(
    (['ayu', 'unverified', 'disabled'] as const).map((key) => [
      world.accounts[key],
      key,
    ]),
  );
  const team = world.organizations.team!;
  const membersPath = `/api/platform/organizations/${platformActiveOrganization.id}/members`;

  const rewrite = async (route: Route, url: URL) => {
    const path = url.pathname;
    const accountId = /^\/api\/platform\/accounts\/([0-9a-f-]{36})$/.exec(
      path,
    )?.[1];
    const organizationId =
      /^\/api\/platform\/organizations\/([0-9a-f-]{36})$/.exec(path)?.[1];
    const fetchReal = async (realUrl?: string) => {
      const response = await route.fetch(realUrl ? { url: realUrl } : {});
      return {
        response,
        body: response.ok() ? ((await response.json()) as unknown) : null,
      };
    };
    let json: (real: unknown) => unknown;
    let realUrl: string | undefined;
    if (path === '/api/platform/accounts')
      json = () => accountsPage(url, world);
    else if (path === '/api/platform/account-invitations')
      json = () => invitationsPage(url);
    else if (path === '/api/platform/organizations')
      json = () => organizationsPage(url, world);
    else if (accountId && accountKeys.has(accountId))
      json = (real) =>
        accountDetail(
          real as Record<string, unknown>,
          accountKeys.get(accountId)!,
          world,
        );
    else if (organizationId === team)
      json = (real) => {
        const body = real as Record<string, unknown>;
        if (body.state !== 'active' || body.slug !== 'hukum-nusantara')
          throw new Error('Hukum Nusantara is not an active organization');
        return PlatformOrganizationDetailSchema.parse({
          ...body,
          id: platformActiveOrganization.id,
          createdAt: platformActiveOrganization.createdAt,
        });
      };
    else if (organizationId === world.harborId)
      json = (real) => {
        const body = real as {
          state: string;
          invitation: Record<string, unknown>;
        };
        if (body.state !== 'provisioning')
          throw new Error('Harbor Legal Partners is not provisioning');
        return PlatformOrganizationDetailSchema.parse({
          ...body,
          id: platformProvisioningOrganization.id,
          createdAt: platformProvisioningOrganization.createdAt,
          ownerEmail: 'owner@harborlegal.co.id',
          invitation: {
            ...body.invitation,
            status: 'pending',
            expiresAt: platformProvisioningOrganization.expiresAt,
          },
        });
      };
    else if (path === membersPath) {
      // The record shows the prototype's organization id; its members are
      // read from the real organization.
      const real = new URL(route.request().url());
      real.pathname = `/api/platform/organizations/${team}/members`;
      realUrl = real.toString();
      json = (body) => {
        const ordered = orderExactCaptureRows(
          body as { items: Array<{ email: string }> },
          platformActiveOrganization.members.map((member) => member.email),
          'Members',
        );
        return PlatformMembersPageSchema.parse({
          ...ordered,
          items: ordered.items.map((item) => ({
            ...item,
            joinedAt: platformActiveOrganization.members.find(
              (member) => member.email === item.email,
            )!.joinedAt,
          })),
        });
      };
    } else return route.fallback();
    const { response, body } = await fetchReal(realUrl);
    if (!response.ok()) return route.fulfill({ response });
    return route.fulfill({ response, json: json(body) });
  };

  const matcher = (url: URL) => url.pathname.startsWith('/api/platform/');
  const handler = (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const work = rewrite(route, new URL(route.request().url())).catch(
      async (error: unknown) => {
        failures.push(error);
        await route.abort().catch(() => undefined);
      },
    );
    pending.add(work);
    void work.finally(() => pending.delete(work));
    return work;
  };
  await page.route(matcher, handler);
  return {
    async remove() {
      await page.unroute(matcher, handler);
      await Promise.all([...pending]);
      if (failures.length) throw failures[0];
    },
  };
}
