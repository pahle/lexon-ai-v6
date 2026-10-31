import { randomUUID } from 'node:crypto';
import nodemailer, { type SendMailOptions } from 'nodemailer';
import { renderEmail } from './email-templates.js';
import type { EmailPort, TransactionalEmail } from './email-port.js';

export interface MailTransport {
  sendMail(options: SendMailOptions): Promise<unknown>;
  close?(): void;
}
export class SmtpMailer implements EmailPort {
  readonly #transport: MailTransport;
  readonly #pending = new Set<Promise<void>>();
  #delivered = 0;
  #failed = 0;
  constructor(
    private readonly options: {
      origin: string;
      from: string;
      url?: string;
      transport?: MailTransport;
    },
  ) {
    this.#transport =
      options.transport ??
      nodemailer.createTransport({
        url: options.url,
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
  }
  async send(message: TransactionalEmail): Promise<{ messageId: string }> {
    const rendered = renderEmail(message, this.options.origin);
    const messageId = `<${randomUUID()}@lexon.local>`;
    // Dispatch is tracked after commit, but SMTP latency never controls an
    // account-existence-sensitive response. No payload/error details are logged.
    const pending = Promise.resolve()
      .then(() =>
        this.#transport.sendMail({
          ...rendered,
          from: { name: 'Lexon', address: this.options.from },
          messageId,
          disableFileAccess: true,
          disableUrlAccess: true,
        }),
      )
      .then(
        () => {
          this.#delivered++;
        },
        () => {
          this.#failed++;
        },
      );
    this.#pending.add(pending);
    void pending.then(() => this.#pending.delete(pending));
    return { messageId };
  }
  deliveryState() {
    return {
      pending: this.#pending.size,
      delivered: this.#delivered,
      failed: this.#failed,
    };
  }
  async drain(timeoutMs: number): Promise<void> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1)
      throw new Error('Invalid mail drain timeout');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all([...this.#pending]),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async onApplicationShutdown(): Promise<void> {
    await this.drain(2000);
    this.#transport.close?.();
  }
}
