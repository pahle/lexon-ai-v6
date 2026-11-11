import { Client } from 'pg';

export const CHAT_DELETION_NOTIFICATION_CHANNEL = 'lexon_chat_deleted';
const RUN_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface PgNotificationListenerOptions {
  readonly appUrl: string;
  readonly onNotification: (payload: string) => void;
  readonly onUnavailable: () => void;
}

/** One process-owned PostgreSQL LISTEN connection for content-free run IDs. */
export class PgNotificationListener {
  #client: Client | undefined;
  #lost = false;
  #closed = false;

  constructor(private readonly options: PgNotificationListenerOptions) {}

  async start(): Promise<void> {
    if (this.#closed || this.#lost)
      throw new Error('Notification listener unavailable');
    const client = new Client({
      connectionString: this.options.appUrl,
      application_name: 'lexon-chat-deletion-events',
      connectionTimeoutMillis: 2000,
      statement_timeout: 2000,
    });
    this.#client = client;
    client.on('error', () => this.#invalidate(client));
    client.on('end', () => this.#invalidate(client));
    client.on('notification', (message) => {
      if (this.#client !== client || this.#lost || this.#closed) return;
      const payload = message.payload;
      if (
        message.channel === CHAT_DELETION_NOTIFICATION_CHANNEL &&
        payload &&
        RUN_ID.test(payload)
      )
        this.options.onNotification(payload.toLowerCase());
    });
    try {
      await client.connect();
      if (this.#client !== client || this.#lost || this.#closed)
        throw new Error('Notification listener unavailable');
      await client.query(`LISTEN ${CHAT_DELETION_NOTIFICATION_CHANNEL}`);
      if (this.#client !== client || this.#lost || this.#closed)
        throw new Error('Notification listener unavailable');
    } catch {
      this.#invalidate(client);
      await client.end().catch(() => undefined);
      throw new Error('Notification listener unavailable');
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    const client = this.#client;
    this.#client = undefined;
    await client?.end().catch(() => undefined);
  }

  #invalidate(client: Client): void {
    if (this.#client !== client || this.#lost || this.#closed) return;
    this.#client = undefined;
    this.#lost = true;
    this.options.onUnavailable();
    void client.end().catch(() => undefined);
  }
}
