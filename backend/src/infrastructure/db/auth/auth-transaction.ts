import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import {
  getCurrentAdapter,
  runWithAdapter,
  runWithTransaction,
} from '@better-auth/core/context';
import type {
  DBAdapter,
  DBTransactionAdapter,
} from '@better-auth/core/db/adapter';
import type { BetterAuthOptions } from 'better-auth';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { bindAuthAudit, endAuthAudit } from './auth-functions.js';
import * as schema from './auth-schema.js';
import type { AuthCommandSession, LexonServerApi } from './auth-types.js';
import type {
  PlatformReadName,
  PlatformReadParam,
} from './platform-read-plugin.js';
import type { SecurityPrimitives } from './security-plugin.js';
import type { SelectionPrimitives } from './selection-plugin.js';

type Database = NodePgDatabase<typeof schema>;
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

// This file is private to database infrastructure. The Drizzle transaction is
// retained here for future named narrow-function implementations, never on the
// command capability or the integration's public surface.
export function createAuthTransactions(database: Database) {
  const scope = new AsyncLocalStorage<{
    database: Transaction;
    adapter: DBTransactionAdapter;
    active: boolean;
    afterCommit: Array<() => Promise<void>>;
    accountInvitationAccepted?: boolean;
  }>();
  let adapter: DBAdapter;
  const adapterFactory = (options: BetterAuthOptions): DBAdapter => {
    const base = drizzleAdapter(database, {
      provider: 'pg',
      schemaName: 'auth',
      schema,
      transaction: true,
    })(options);
    async function currentAdapter() {
      const state = scope.getStore();
      if (state) {
        if (!state.active) throw new Error('Auth command session expired');
        return state.adapter;
      }
      const current = await getCurrentAdapter(base);
      return current === adapter ? base : current;
    }
    adapter = {
      ...base,
      create: async (data) => (await currentAdapter()).create(data),
      findOne: async (data) => (await currentAdapter()).findOne(data),
      findMany: async (data) => (await currentAdapter()).findMany(data),
      count: async (data) => (await currentAdapter()).count(data),
      update: async (data) => (await currentAdapter()).update(data),
      updateMany: async (data) => (await currentAdapter()).updateMany(data),
      delete: async (data) => (await currentAdapter()).delete(data),
      deleteMany: async (data) => (await currentAdapter()).deleteMany(data),
      consumeOne: async (data) => (await currentAdapter()).consumeOne(data),
      incrementOne: async (data) => (await currentAdapter()).incrementOne(data),
      transaction: async (callback) => {
        // The public HTTP handler establishes its own Better Auth adapter
        // context. Join our already-open transaction even after that reset.
        const existing = scope.getStore();
        if (existing) {
          if (!existing.active) throw new Error('Auth command session expired');
          return callback(existing.adapter);
        }
        const afterCommit: Array<() => Promise<void>> = [];
        const result = await database.transaction(async (tx) => {
          const current = drizzleAdapter(tx, {
            provider: 'pg',
            schemaName: 'auth',
            schema,
            transaction: true,
          })(options);
          const state = {
            database: tx,
            adapter: current,
            active: true,
            afterCommit,
          };
          try {
            return await scope.run(state, () => callback(current));
          } finally {
            state.active = false;
          }
        });
        for (const callback of afterCommit) await callback();
        return result;
      },
    };
    return adapter;
  };
  async function transaction<T>(
    api: LexonServerApi,
    work: (session: AuthCommandSession) => Promise<T>,
  ): Promise<T> {
    // Establish our own scope even when another engine is active on the caller.
    return runWithAdapter(adapter, () =>
      runWithTransaction(adapter, async () => {
        const state = scope.getStore();
        if (!state) throw new Error('Auth transaction unavailable');
        let active = true;
        const session = Object.freeze({
          async call<K extends keyof LexonServerApi>(
            name: K,
            input: Parameters<LexonServerApi[K]>[0],
          ) {
            if (!active || !state.active || scope.getStore() !== state)
              throw new Error('Auth command session expired');
            if (name === 'impersonateUser' || name === 'stopImpersonating')
              throw new Error('Server operation unavailable');
            const invoke = api[name] as (
              input: Parameters<LexonServerApi[K]>[0],
            ) => Promise<Awaited<ReturnType<LexonServerApi[K]>>>;
            const result = await invoke(input);
            if (result instanceof Response && result.status >= 400)
              throw new Error('Auth command failed');
            return result;
          },
        }) as AuthCommandSession;
        bindAuthAudit(session, async (event) => {
          if (!active || !state.active || scope.getStore() !== state)
            throw new Error('Auth command session expired');
          await state.database.execute(
            sql`SELECT auth.lexon_append_audit(${JSON.stringify(event)}::jsonb)`,
          );
        });
        try {
          return await work(session);
        } finally {
          active = false;
          endAuthAudit(session);
        }
      }),
    );
  }
  async function afterCommit(callback: () => Promise<void>): Promise<void> {
    const state = scope.getStore();
    if (!state?.active) throw new Error('Auth transaction unavailable');
    state.afterCommit.push(callback);
  }
  const accountLocks = {
    async grants(
      invitationId: string | undefined,
      setupDigest: string | undefined,
    ) {
      const state = scope.getStore();
      if (!state?.active) throw new Error('Auth transaction unavailable');
      await state.database.execute(
        sql`SELECT auth.lexon_lock_signup_grants(${invitationId ?? null}::uuid, ${setupDigest ?? null}::text)`,
      );
    },
    async user(userId: string) {
      const state = scope.getStore();
      if (!state?.active) throw new Error('Auth transaction unavailable');
      await state.database.execute(
        sql`SELECT auth.lexon_lock_account(${userId}::uuid)`,
      );
    },
    async accountInvitation(digest: string) {
      const state = scope.getStore();
      if (!state?.active) throw new Error('Auth transaction unavailable');
      const result = await state.database.execute<{
        id: string;
        email: string;
        usable: boolean;
      }>(
        sql`SELECT id, email, usable FROM auth.lexon_account_invitation_signup_facts(${digest}::text)`,
      );
      return result.rows[0] ?? null;
    },
    markAccountInvitation() {
      const state = scope.getStore();
      if (!state?.active) throw new Error('Auth transaction unavailable');
      state.accountInvitationAccepted = true;
    },
    async acceptAccountInvitation(digest: string, userId: string) {
      const state = scope.getStore();
      if (!state?.active) throw new Error('Auth transaction unavailable');
      const result = await state.database.execute<{ ok: boolean }>(
        sql`SELECT auth.lexon_accept_account_invitation(${digest}::text, ${userId}::uuid) AS ok`,
      );
      return result.rows[0]?.ok === true;
    },
  };
  // Request-scoped: lives in the transaction's AsyncLocalStorage state.
  const accountInvitationFlag = () =>
    scope.getStore()?.accountInvitationAccepted === true;
  const securityPrimitives: SecurityPrimitives = {
    async lock(userId, sessionId) {
      const state = scope.getStore();
      if (!state?.active) throw new Error('Auth transaction unavailable');
      await state.database.execute(
        sql`SELECT auth.lexon_lock_security(${userId}::uuid,${sessionId}::uuid)`,
      );
    },
    async write(input) {
      const state = scope.getStore();
      if (!state?.active) throw new Error('Auth transaction unavailable');
      await state.database.execute(
        sql`SELECT auth.lexon_write_session_security(${JSON.stringify(input)}::jsonb)`,
      );
    },
  };
  const organizationPrimitives = {
    async lock(id: string) {
      const state = scope.getStore();
      if (!state?.active) throw new Error('Auth transaction unavailable');
      await state.database.execute(
        sql`SELECT auth.lexon_lock_organization(${id}::uuid)`,
      );
    },
  };
  const selectionPrimitives: SelectionPrimitives = {
    async lock(userId, sessionId, targetId) {
      const state = scope.getStore();
      if (!state?.active) throw new Error('Auth transaction unavailable');
      await state.database.execute(
        sql`SELECT auth.lexon_lock_selection(${userId}::uuid,${sessionId}::uuid,${targetId ?? null}::uuid)`,
      );
    },
    async write(input) {
      const state = scope.getStore();
      if (!state?.active) throw new Error('Auth transaction unavailable');
      const result = await state.database.execute<{ applied: boolean }>(
        sql`SELECT auth.lexon_write_selection(${input.userId}::uuid,${input.sessionId}::uuid,${input.expectedOrganizationId}::text,${input.expectedVersion}::bigint,${input.organizationId}::uuid,${input.pendingOrganizationId}::uuid,${input.expectedMemberId}::uuid) AS applied`,
      );
      return result.rows[0]?.applied === true;
    },
  };
  // Each read runs one named auth.lexon_platform_* function. Rows come back as
  // JSON so timestamp-without-time-zone columns are not reinterpreted in the
  // server's local zone by the driver.
  const pgArray = (values: (string | boolean)[] | null, cast: string) =>
    values === null
      ? sql`${null}::${sql.raw(cast)}`
      : sql`${`{${values.map((v) => `"${String(v)}"`).join(',')}}`}::${sql.raw(cast)}`;
  const platformReadPrimitives = {
    async run(name: PlatformReadName, p: PlatformReadParam[]) {
      const state = scope.getStore();
      if (!state?.active) throw new Error('Auth transaction unavailable');
      const text = (i: number) => sql`${(p[i] as string | null) ?? null}::text`;
      const uuid = (i: number) => sql`${p[i] as string}::uuid`;
      const int = (i: number) => sql`${p[i] as number}::int`;
      const arr = (i: number, cast: string) =>
        pgArray(p[i] as (string | boolean)[] | null, cast);
      const calls: Record<PlatformReadName, () => ReturnType<typeof sql>> = {
        accounts: () =>
          sql`auth.lexon_platform_accounts(${text(0)},${arr(1, 'text[]')},${arr(2, 'boolean[]')},${int(3)},${int(4)})`,
        accountsTotal: () =>
          sql`auth.lexon_platform_accounts_total(${text(0)},${arr(1, 'text[]')},${arr(2, 'boolean[]')})`,
        account: () => sql`auth.lexon_platform_account(${uuid(0)})`,
        accountTeams: () => sql`auth.lexon_platform_account_teams(${uuid(0)})`,
        organizations: () =>
          sql`auth.lexon_platform_organizations(${text(0)},${arr(1, 'text[]')},${int(2)},${int(3)})`,
        organizationsTotal: () =>
          sql`auth.lexon_platform_organizations_total(${text(0)},${arr(1, 'text[]')})`,
        organization: () => sql`auth.lexon_platform_organization(${uuid(0)})`,
        members: () =>
          sql`auth.lexon_platform_members(${uuid(0)},${int(1)},${int(2)})`,
        membersTotal: () => sql`auth.lexon_platform_members_total(${uuid(0)})`,
        invitations: () =>
          sql`auth.lexon_platform_account_invitations(${text(0)},${arr(1, 'text[]')},${int(2)},${int(3)})`,
        invitationsTotal: () =>
          sql`auth.lexon_platform_account_invitations_total(${text(0)},${arr(1, 'text[]')})`,
        lockEnabledAdmins: () => sql`auth.lexon_platform_lock_enabled_admins()`,
        createInvitation: () =>
          sql`auth.lexon_create_account_invitation(${text(0)},${text(1)},${text(2)},${uuid(3)})`,
        resendInvitation: () =>
          sql`auth.lexon_resend_account_invitation(${uuid(0)},${text(1)})`,
        cancelInvitation: () =>
          sql`auth.lexon_cancel_account_invitation(${uuid(0)})`,
      };
      const scalar = name.endsWith('Total') || name === 'cancelInvitation';
      const result = await state.database.execute<{ row: unknown }>(
        scalar
          ? sql`SELECT to_jsonb(t) AS row FROM (SELECT ${calls[name]()} AS ${sql.raw(name === 'cancelInvitation' ? 'cancelled' : 'total')}) t`
          : sql`SELECT to_jsonb(f) AS row FROM ${calls[name]()} f`,
      );
      return result.rows.map((r) => r.row as Record<string, unknown>);
    },
  };
  return {
    adapterFactory,
    platformReadPrimitives,
    transaction,
    afterCommit,
    accountInvitationFlag,
    accountLocks,
    securityPrimitives,
    organizationPrimitives,
    selectionPrimitives,
    adminSetupPrimitives: {
      async lock(digest: string, userId: string | null) {
        const state = scope.getStore();
        if (!state?.active) throw new Error('Auth transaction unavailable');
        await state.database.execute(
          sql`SELECT auth.lexon_lock_admin_setup(${digest}::text,${userId}::uuid)`,
        );
      },
      async hasTeamMembership(userId: string) {
        const state = scope.getStore();
        if (!state?.active) throw new Error('Auth transaction unavailable');
        const result = await state.database.execute<{ present: boolean }>(
          sql`SELECT auth.lexon_setup_has_team(${userId}::uuid) AS present`,
        );
        return result.rows[0]?.present === true;
      },
      async consume(digest: string, userId: string, expectedValue: string) {
        const state = scope.getStore();
        if (!state?.active) throw new Error('Auth transaction unavailable');
        const result = await state.database.execute<{ applied: boolean }>(
          sql`SELECT auth.lexon_consume_admin_setup(${digest}::text,${userId}::uuid,${expectedValue}::text) AS applied`,
        );
        return result.rows[0]?.applied === true;
      },
    },
    provisioningPrimitives: {
      async cancel(organizationId: string, invitationId: string) {
        const state = scope.getStore();
        if (!state?.active) throw new Error('Auth transaction unavailable');
        const result = await state.database.execute<{ cancelled: boolean }>(
          sql`SELECT auth.lexon_cancel_provisioning(${organizationId}::uuid,${invitationId}::uuid) AS cancelled`,
        );
        return result.rows[0]?.cancelled === true;
      },
    },
  };
}
