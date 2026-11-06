import { Pool } from 'pg';
import {
  bindPool,
  beginSession,
  endSession,
  requireSession,
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

export interface TenantTransactionOptions {
  /** PostgreSQL-enforced wall-clock deadline for this transaction. */
  readonly timeoutMs?: number;
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
    fn: (tx: TenantSession, signal?: AbortSignal) => Promise<T>,
    options: TenantTransactionOptions = {},
  ): Promise<T> {
    const timeoutMs = options.timeoutMs;
    if (
      timeoutMs !== undefined &&
      (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
    )
      throw new Error('Invalid tenant transaction timeout');
    const context = validateTenantContext(ctx);
    const client = await this.#pool.connect();
    let session: TenantSession | undefined;
    // A connection whose ROLLBACK failed may still hold an open transaction
    // and this tenant's context, so it is destroyed instead of reused.
    let releaseError: Error | undefined;
    let connectionError: Error | undefined;
    let notifyConnectionEnd!: () => void;
    const connectionEnded = new Promise<void>((resolve) => {
      notifyConnectionEnd = resolve;
    });
    const handleConnectionError = (error: Error) => {
      connectionError = error;
      notifyConnectionEnd();
    };
    const controller = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs !== undefined) client.on('error', handleConnectionError);
    try {
      await client.query('BEGIN');
      await client.query(
        "SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)",
        [context.orgId, context.userId ?? ''],
      );
      if (timeoutMs !== undefined) {
        await client.query(
          "SELECT set_config('transaction_timeout', $1, true)",
          [String(timeoutMs)],
        );
      }
      session = beginSession(client, context);
      const operation = Promise.resolve().then(() =>
        fn(session!, controller.signal),
      );
      // A timed-out callback may be paused in application code. It is safe to
      // detach only after PostgreSQL has terminated this transaction and the
      // opaque session has expired, so it cannot issue a later query.
      void operation.catch(() => undefined);
      let result: T;
      if (timeoutMs === undefined) {
        result = await operation;
      } else {
        const transactionFailure = connectionEnded.then(() => {
          if (connectionError?.message.includes('transaction timeout')) {
            timedOut = true;
            if (session) endSession(session);
            controller.abort(new Error('Tenant transaction timed out'));
            throw new Error('Tenant transaction timed out');
          }
          throw connectionError ?? new Error('Database connection failed');
        });
        const deadlineFailure = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            timedOut = true;
            if (session) endSession(session);
            controller.abort(new Error('Tenant transaction timed out'));
            void connectionEnded.then(() =>
              reject(new Error('Tenant transaction timed out')),
            );
          }, timeoutMs);
        });
        result = await Promise.race([
          operation,
          transactionFailure,
          deadlineFailure,
        ]);
      }
      if (timedOut) throw new Error('Tenant transaction timed out');
      endSession(session);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (session) endSession(session);
      await client.query('ROLLBACK').catch(() => {
        releaseError = new Error('Rollback failed');
      });
      if (timedOut) {
        throw new Error('Tenant transaction timed out', { cause: error });
      }
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (session) endSession(session);
      client.release(releaseError ?? connectionError);
      if (timeoutMs !== undefined)
        client.removeListener('error', handleConnectionError);
    }
  }

  assertSessionContext(session: TenantSession, input: TenantContext): void {
    const context = validateTenantContext(input);
    const active = requireSession(session).ctx;
    if (
      active.orgId !== context.orgId ||
      (active.userId ?? undefined) !== (context.userId ?? undefined)
    )
      throw new Error('Tenant session context mismatch');
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
