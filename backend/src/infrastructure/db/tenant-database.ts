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

export class TenantTransactionTimeoutError extends Error {
  constructor(options?: ErrorOptions) {
    super('Tenant transaction timed out', options);
    this.name = 'TenantTransactionTimeoutError';
  }
}

function isTransactionTimeoutError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === '25P04';
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
    const originalQuery = client.query;
    let inFlightQueries = 0;
    client.query = ((...args: unknown[]) => {
      inFlightQueries += 1;
      let result: unknown;
      try {
        result = Reflect.apply(originalQuery, client, args);
      } catch (error) {
        inFlightQueries -= 1;
        throw error;
      }
      if (
        typeof result === 'object' &&
        result !== null &&
        'then' in result &&
        typeof result.then === 'function'
      )
        return Promise.resolve(result).finally(() => {
          inFlightQueries -= 1;
        });
      inFlightQueries -= 1;
      return result;
    }) as typeof client.query;
    let session: TenantSession | undefined;
    // A connection whose ROLLBACK failed may still hold an open transaction
    // and this tenant's context, so it is destroyed instead of reused.
    let releaseError: Error | undefined;
    let connectionError: Error | undefined;
    let notifyConnectionEnd!: () => void;
    const connectionEnded = new Promise<void>((resolve) => {
      notifyConnectionEnd = resolve;
    });
    let notifyClientClosed!: () => void;
    const clientClosed = new Promise<void>((resolve) => {
      notifyClientClosed = resolve;
    });
    let released = false;
    const releaseClient = (error?: Error) => {
      if (released) return;
      released = true;
      client.query = originalQuery;
      client.release(error);
    };
    const handleConnectionEnd = () => {
      notifyConnectionEnd();
      notifyClientClosed();
    };
    const handleConnectionError = (error: Error) => {
      connectionError = error;
      notifyConnectionEnd();
    };
    const controller = new AbortController();
    let timedOut = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let rejectDeadline!: (error: TenantTransactionTimeoutError) => void;
    const deadlineFailure = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    const waitForDeadline = <T>(operation: Promise<T>): Promise<T> =>
      timeoutMs === undefined
        ? operation
        : Promise.race([operation, deadlineFailure]);
    if (timeoutMs !== undefined) {
      client.on('error', handleConnectionError);
      client.once('end', handleConnectionEnd);
      timeout = setTimeout(() => {
        timedOut = true;
        const error = new TenantTransactionTimeoutError();
        releaseError = error;
        if (session) endSession(session);
        controller.abort(new Error('Tenant transaction timed out'));
        let cleanup = Promise.resolve();
        if (!connectionError && inFlightQueries === 0) {
          try {
            // Activate public Client.end() while the callback is paused; pg
            // then force-closes the checked-out socket on error release.
            cleanup = client.query('ROLLBACK').then(
              () => undefined,
              () => undefined,
            );
          } catch {
            cleanup = Promise.resolve();
          }
        }
        releaseClient(error);
        void Promise.all([clientClosed, cleanup]).then(() =>
          rejectDeadline(error),
        );
      }, timeoutMs);
    }
    try {
      await waitForDeadline(client.query('BEGIN'));
      await waitForDeadline(
        client.query(
          "SELECT set_config('app.org_id', $1, true), set_config('app.user_id', $2, true)",
          [context.orgId, context.userId ?? ''],
        ),
      );
      if (timeoutMs !== undefined) {
        await waitForDeadline(
          client.query("SELECT set_config('transaction_timeout', $1, true)", [
            String(timeoutMs),
          ]),
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
          if (isTransactionTimeoutError(connectionError)) {
            timedOut = true;
            if (session) endSession(session);
            controller.abort(new Error('Tenant transaction timed out'));
            throw new TenantTransactionTimeoutError();
          }
          throw connectionError ?? new Error('Database connection failed');
        });
        result = await Promise.race([
          waitForDeadline(operation),
          transactionFailure,
        ]);
      }
      if (timedOut) throw new TenantTransactionTimeoutError();
      endSession(session);
      await waitForDeadline(client.query('COMMIT'));
      return result;
    } catch (error) {
      if (
        isTransactionTimeoutError(error) ||
        isTransactionTimeoutError(connectionError)
      ) {
        timedOut = true;
        controller.abort(new Error('Tenant transaction timed out'));
      }
      if (session) endSession(session);
      if (timedOut) {
        releaseClient(releaseError ?? new TenantTransactionTimeoutError());
        await clientClosed;
        throw new TenantTransactionTimeoutError({ cause: error });
      }
      if (connectionError) {
        releaseError = connectionError;
        releaseClient(connectionError);
        await clientClosed;
        throw connectionError;
      }
      await client.query('ROLLBACK').catch(() => {
        releaseError = new Error('Rollback failed');
      });
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (session) endSession(session);
      releaseClient(releaseError ?? connectionError);
      if (timeoutMs !== undefined) {
        client.removeListener('error', handleConnectionError);
        client.removeListener('end', handleConnectionEnd);
      }
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
