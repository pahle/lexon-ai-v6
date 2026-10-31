import { Pool } from 'pg';
import {
  bindPool,
  beginSession,
  endSession,
  type TenantSession,
} from './tenant-session.js';
import {
  validateTenantContext,
  type TenantContext,
} from './authorization-predicate.js';

export interface DatabaseOptions {
  appUrl: string;
  poolMax: number;
  statementTimeoutMs: number;
}

export class TenantDatabase {
  readonly #pool: Pool;

  constructor(options: DatabaseOptions) {
    this.#pool = new Pool({
      connectionString: options.appUrl,
      max: options.poolMax,
      statement_timeout: options.statementTimeoutMs,
      connectionTimeoutMillis: 5000,
    });
    // An idle-connection failure is reflected by the next bounded health query.
    this.#pool.on('error', () => undefined);
    bindPool(this, this.#pool);
  }

  async withTenant<T>(
    ctx: TenantContext,
    fn: (tx: TenantSession) => Promise<T>,
  ): Promise<T> {
    const context = validateTenantContext(ctx);
    const client = await this.#pool.connect();
    let session: TenantSession | undefined;
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)",
        [context.orgId, context.userId ?? ''],
      );
      session = beginSession(client, context);
      const result = await fn(session);
      endSession(session);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      if (session) endSession(session);
      client.release();
    }
  }

  async check(): Promise<'up' | 'down'> {
    try {
      await this.#pool.query('SELECT 1');
      return 'up';
    } catch {
      return 'down';
    }
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}
