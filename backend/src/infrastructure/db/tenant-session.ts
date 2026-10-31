import type { Pool, PoolClient } from 'pg';
import type { TenantContext } from './authorization-predicate.js';

declare const sessionBrand: unique symbol;
export interface TenantSession {
  readonly [sessionBrand]: true;
}
const sessions = new WeakMap<
  TenantSession,
  { client: PoolClient; ctx: TenantContext }
>();
const pools = new WeakMap<object, Pool>();

// Private implementation exports: never re-export these through the db index.
export function bindPool(owner: object, pool: Pool): void {
  pools.set(owner, pool);
}
export function inspectPool(owner: object): Pool {
  const pool = pools.get(owner);
  if (!pool) throw new Error('Unknown database');
  return pool;
}
export function beginSession(
  client: PoolClient,
  ctx: TenantContext,
): TenantSession {
  const session = Object.freeze(Object.create(null)) as TenantSession;
  sessions.set(session, { client, ctx });
  return session;
}
export function endSession(session: TenantSession): void {
  sessions.delete(session);
}
export function requireSession(session: TenantSession) {
  const state = sessions.get(session);
  if (!state) throw new Error('Tenant session expired');
  return state;
}
