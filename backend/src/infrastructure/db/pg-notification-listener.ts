import { Client } from 'pg';
import { z } from 'zod';

export const CHAT_DELETION_NOTIFICATION_CHANNEL = 'lexon_chat_deleted';
export const CHAT_TITLE_NOTIFICATION_CHANNEL = 'lexon_chat_title';
const RUN_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ChatTitleNotificationSchema = z.strictObject({
  orgId: z.uuid(),
  userId: z.uuid(),
  chatId: z.uuid(),
});
export type ChatTitleNotification = z.infer<typeof ChatTitleNotificationSchema>;

export interface PgNotificationListenerOptions {
  readonly appUrl: string;
  readonly onNotification: (payload: string) => void;
  readonly onChatTitleNotification: (
    notification: ChatTitleNotification,
  ) => void;
  readonly onUnavailable: () => void;
}

/** One process-owned PostgreSQL LISTEN connection for content-free IDs. */
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
      if (message.channel === CHAT_TITLE_NOTIFICATION_CHANNEL && payload) {
        const parsed = ChatTitleNotificationSchema.safeParse(
          parseJson(payload),
        );
        if (parsed.success)
          this.options.onChatTitleNotification({
            orgId: parsed.data.orgId.toLowerCase(),
            userId: parsed.data.userId.toLowerCase(),
            chatId: parsed.data.chatId.toLowerCase(),
          });
      }
    });
    try {
      await client.connect();
      if (this.#client !== client || this.#lost || this.#closed)
        throw new Error('Notification listener unavailable');
      await client.query(`LISTEN ${CHAT_DELETION_NOTIFICATION_CHANNEL}`);
      await client.query(`LISTEN ${CHAT_TITLE_NOTIFICATION_CHANNEL}`);
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

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
