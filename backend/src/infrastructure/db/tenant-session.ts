import type { Pool, PoolClient } from 'pg';
import type { TenantContext } from './authorization-predicate.js';

/**
 * Bound for every lock wait on the per-organization claim lane
 * (`lexon.ai_step_claim` advisory and the row locks taken behind it). The lane
 * serializes claim mutations; without a bound a stalled writer hangs every
 * same-org claimant past any test or request deadline. Writers that lose the
 * wait read SQLSTATE 55P03 and report their existing "unavailable" result.
 */
export const CLAIM_LANE_LOCK_TIMEOUT_MS = 5000;

export async function applyClaimLaneLockTimeout(
  client: PoolClient,
): Promise<void> {
  await client.query(`SET LOCAL lock_timeout=${CLAIM_LANE_LOCK_TIMEOUT_MS}`);
}

export function isLockWaitTimeout(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '55P03'
  );
}

declare const sessionBrand: unique symbol;
export interface TenantSession {
  readonly [sessionBrand]: true;
}
const sessions = new WeakMap<
  TenantSession,
  { client: PoolClient; ctx: TenantContext; pool: Pool }
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
  pool: Pool,
): TenantSession {
  const session = Object.freeze(Object.create(null)) as TenantSession;
  sessions.set(session, { client, ctx, pool });
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

export function assertTenantSession(
  owner: object,
  session: TenantSession,
  ctx: TenantContext,
): void {
  const state = requireSession(session);
  if (
    state.pool !== inspectPool(owner) ||
    state.ctx.orgId !== ctx.orgId ||
    state.ctx.userId !== ctx.userId
  )
    throw new Error('Tenant session unavailable');
}
