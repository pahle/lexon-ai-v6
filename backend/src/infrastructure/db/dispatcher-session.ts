import { Client } from 'pg';

// Fixed application-specific two-integer advisory key; scoped by PostgreSQL database.
export const DISPATCHER_LOCK = [1279613007, 0] as const;
export class DispatcherSession {
  #client: Client | undefined;
  #leader = false;
  #closed = false;
  #pendingWake = false;
  #wake: (() => void) | undefined;
  constructor(private readonly appUrl: string) {}
  async tryAcquire(): Promise<boolean> {
    if (this.#closed) throw new Error('Dispatcher session closed');
    try {
      if (!this.#client) {
        const client = new Client({
          connectionString: this.appUrl,
          application_name: 'lexon-dispatcher',
          connectionTimeoutMillis: 2000,
          statement_timeout: 2000,
        });
        this.#client = client;
        const lost = () => {
          if (this.#client === client) {
            this.#leader = false;
            this.#client = undefined;
            this.#pendingWake = true;
            this.#wake?.();
            void client.end().catch(() => undefined);
          }
        };
        client.on('error', lost);
        client.on('end', lost);
        client.on('notification', () => {
          this.#pendingWake = true;
          this.#wake?.();
        });
        await client.connect();
        await client.query('LISTEN lexon_outbox');
      }
      const client = this.#client;
      if (!client) throw new Error('Disconnected');
      if (this.#leader) {
        await client.query('SELECT 1');
        return this.isLeader();
      }
      const result = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock($1,$2) AS acquired',
        [...DISPATCHER_LOCK],
      );
      this.#leader = this.#client === client && result.rows[0]!.acquired;
      return this.#leader;
    } catch {
      this.#leader = false;
      const client = this.#client;
      this.#client = undefined;
      await client?.end().catch(() => undefined);
      throw new Error('Dispatcher database unavailable');
    }
  }
  isLeader(): boolean {
    return this.#leader && !this.#closed;
  }
  async waitForWake(timeoutMs: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;
    if (this.#pendingWake) {
      this.#pendingWake = false;
      return;
    }
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        this.#wake = undefined;
        this.#pendingWake = false;
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      this.#wake = done;
      signal.addEventListener('abort', done, { once: true });
      if (signal.aborted) done();
    });
  }
  async close(): Promise<void> {
    this.#closed = true;
    this.#leader = false;
    this.#wake?.();
    const client = this.#client;
    this.#client = undefined;
    await client?.end().catch(() => undefined);
  }
}
