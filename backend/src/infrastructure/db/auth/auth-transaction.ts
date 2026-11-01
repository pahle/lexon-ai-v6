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
import type { SecurityPrimitives } from './security-plugin.js';

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
  };
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
  return {
    adapterFactory,
    transaction,
    afterCommit,
    accountLocks,
    securityPrimitives,
    organizationPrimitives,
  };
}
