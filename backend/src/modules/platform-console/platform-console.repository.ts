import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { IdentityError } from '../identity-access/index.js';
import {
  PlatformAccountDetailSchema,
  PlatformAccountsPageSchema,
  PlatformMembersPageSchema,
  PlatformOrganizationDetailSchema,
  PlatformOrganizationsPageSchema,
  AccountInvitationsPageSchema,
  type PageSize,
  type PlatformAccountDetail,
  type PlatformAccountsPage,
  type PlatformMembersPage,
  type PlatformOrganizationDetail,
  type PlatformOrganizationsPage,
  type AccountInvitationsPage,
} from '@lexon/contracts';
import type { AuthCommandSession } from '../../infrastructure/db/index.js';
import { escapeLike } from './search-escape.js';

type Row = Record<string, unknown>;
export interface PageRequest {
  page: number;
  pageSize: PageSize;
}
const offset = (p: PageRequest) => (p.page - 1) * p.pageSize;
// Convert bigint counts (JSON number or string) to numbers.
const num = (v: unknown) => Number(v);
// `timestamp` columns are UTC without a zone suffix; timestamptz carry one.
export function iso(value: unknown): string {
  const s = String(value);
  return new Date(/(Z|[+-]\d\d(:?\d\d)?)$/.test(s) ? s : `${s}Z`).toISOString();
}
// Same mapping as the provisioning summary: pending past its expiry is expired.
function provisioningInvitationStatus(status: string, expiresAt: string) {
  if (status === 'pending')
    return new Date(expiresAt) <= new Date() ? 'expired' : 'pending';
  if (status === 'accepted') return 'accepted';
  if (status === 'rejected') return 'declined';
  if (status === 'canceled') return 'cancelled';
  return status;
}
const isoOrNull = (v: unknown) =>
  v === null || v === undefined ? null : iso(v);

// Fail closed: a response that violates its own contract is a 503, not a 400.
function check<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new IdentityError('AUTH_UNAVAILABLE', 503);
  return parsed.data;
}

export async function toNumberedPage<T>(
  rows: { item: T; total: number }[],
  page: number,
  pageSize: PageSize,
  totalFallback: () => Promise<number>,
) {
  const total = rows[0] ? rows[0].total : await totalFallback();
  return { items: rows.map((r) => r.item), page, pageSize, total };
}

@Injectable()
export class PlatformConsoleRepository {
  private async rows(
    tx: AuthCommandSession,
    name: string,
    params: unknown[],
  ): Promise<Row[]> {
    const out = await tx.call('lexonPlatformRead', {
      body: { name, params } as never,
    });
    return (out as { rows: Row[] }).rows;
  }
  private like(query: string | undefined) {
    return query === undefined ? null : escapeLike(query);
  }
  private async count(
    tx: AuthCommandSession,
    name: string,
    params: unknown[],
  ): Promise<number> {
    return num((await this.rows(tx, name, params))[0]?.total ?? 0);
  }
  private account(r: Row) {
    return {
      id: r.id,
      name: r.name,
      email: r.email,
      status: r.status,
      twoFactorEnabled: r.two_factor_enabled,
      isPlatformAdministrator: r.is_platform_administrator,
      teamCount: num(r.team_count),
      createdAt: iso(r.created_at),
      lastActiveAt: isoOrNull(r.last_active_at),
    };
  }
  async accounts(
    tx: AuthCommandSession,
    filter: {
      query?: string | undefined;
      status?: string[] | undefined;
      twoFactor?: ('on' | 'off')[] | undefined;
    },
    page: PageRequest,
  ): Promise<PlatformAccountsPage> {
    const q = this.like(filter.query);
    const statuses = filter.status ?? null;
    const factor = filter.twoFactor?.map((v) => v === 'on') ?? null;
    const rows = await this.rows(tx, 'accounts', [
      q,
      statuses,
      factor,
      page.pageSize,
      offset(page),
    ]);
    return check(
      PlatformAccountsPageSchema,
      await toNumberedPage(
        rows.map((r) => ({ item: this.account(r), total: num(r.total) })),
        page.page,
        page.pageSize,
        () => this.count(tx, 'accountsTotal', [q, statuses, factor]),
      ),
    );
  }
  async accountDetail(
    tx: AuthCommandSession,
    id: string,
  ): Promise<PlatformAccountDetail | null> {
    const [r] = await this.rows(tx, 'account', [id]);
    if (!r) return null;
    const teams = await this.rows(tx, 'accountTeams', [id]);
    return check(PlatformAccountDetailSchema, {
      ...this.account(r),
      emailVerified: r.email_verified,
      activeSessionCount: num(r.active_session_count),
      teams: teams.map((t) => ({
        organizationId: t.organization_id,
        name: t.name,
        slug: t.slug,
        role: t.role,
      })),
    });
  }
  async organizations(
    tx: AuthCommandSession,
    filter: { query?: string | undefined; state?: string[] | undefined },
    page: PageRequest,
  ): Promise<PlatformOrganizationsPage> {
    const q = this.like(filter.query);
    const states = filter.state ?? null;
    const rows = await this.rows(tx, 'organizations', [
      q,
      states,
      page.pageSize,
      offset(page),
    ]);
    return check(
      PlatformOrganizationsPageSchema,
      await toNumberedPage(
        rows.map((r) => ({
          item: {
            id: r.id,
            name: r.name,
            slug: r.slug,
            state: r.state,
            memberCount: num(r.member_count),
            ownerEmail: r.owner_email,
            createdAt: iso(r.created_at),
          },
          total: num(r.total),
        })),
        page.page,
        page.pageSize,
        () => this.count(tx, 'organizationsTotal', [q, states]),
      ),
    );
  }
  async organization(
    tx: AuthCommandSession,
    id: string,
  ): Promise<PlatformOrganizationDetail | null> {
    const [r] = await this.rows(tx, 'organization', [id]);
    if (!r) return null;
    const base = {
      id: r.id,
      name: r.name,
      slug: r.slug,
      memberCount: num(r.member_count),
      ownerEmail: r.owner_email,
      createdAt: iso(r.created_at),
    };
    if (r.state === 'active')
      return check(PlatformOrganizationDetailSchema, {
        ...base,
        state: 'active',
        requireTwoFactor: r.require2fa,
      });
    return check(PlatformOrganizationDetailSchema, {
      version: 1,
      ...base,
      kind: 'team',
      state: 'provisioning',
      invitation: {
        id: r.invitation_id,
        status: provisioningInvitationStatus(
          String(r.invitation_status),
          iso(r.invitation_expires_at),
        ),
        expiresAt: iso(r.invitation_expires_at),
      },
    });
  }
  async members(
    tx: AuthCommandSession,
    id: string,
    page: PageRequest,
  ): Promise<PlatformMembersPage> {
    const rows = await this.rows(tx, 'members', [
      id,
      page.pageSize,
      offset(page),
    ]);
    return check(
      PlatformMembersPageSchema,
      await toNumberedPage(
        rows.map((r) => ({
          item: {
            userId: r.user_id,
            name: r.name,
            email: r.email,
            role: r.role,
            joinedAt: iso(r.joined_at),
          },
          total: num(r.total),
        })),
        page.page,
        page.pageSize,
        () => this.count(tx, 'membersTotal', [id]),
      ),
    );
  }
  async invitations(
    tx: AuthCommandSession,
    filter: { query?: string | undefined; status?: string[] | undefined },
    page: PageRequest,
  ): Promise<AccountInvitationsPage> {
    const q = this.like(filter.query);
    const statuses = filter.status ?? null;
    const rows = await this.rows(tx, 'invitations', [
      q,
      statuses,
      page.pageSize,
      offset(page),
    ]);
    return check(
      AccountInvitationsPageSchema,
      await toNumberedPage(
        rows.map((r) => ({
          item: {
            id: r.id,
            email: r.email,
            name: r.name,
            status: r.status,
            invitedBy: r.invited_by_name,
            sentAt: iso(r.sent_at),
            expiresAt: iso(r.expires_at),
          },
          total: num(r.total),
        })),
        page.page,
        page.pageSize,
        () => this.count(tx, 'invitationsTotal', [q, statuses]),
      ),
    );
  }
}
