import {
  OutboxRepository,
  DispatcherSession,
} from '../../infrastructure/db/index.js';
import type { QueueProducer } from '../../infrastructure/queue/index.js';
export interface DispatcherOptions {
  pollMs: number;
  retryBaseMs: number;
  retryCapMs: number;
  batchSize: number;
  leaseMs: number;
  enqueueTimeoutMs: number;
}
export class OutboxDispatcher {
  #status: 'active' | 'standby' | 'unhealthy' = 'unhealthy';
  #enqueueFailed = false;
  #lastProgress = 0;
  #running = false;
  constructor(
    private readonly repository: OutboxRepository,
    private readonly session: DispatcherSession,
    private readonly producer: Pick<QueueProducer, 'enqueue'>,
    private readonly options: DispatcherOptions,
  ) {}
  status() {
    return this.#status === 'active' && !this.session.isLeader()
      ? 'unhealthy'
      : this.#status;
  }
  isProgressing(staleMs: number, now = Date.now()): boolean {
    return this.#running && now - this.#lastProgress < staleMs;
  }
  async start(signal: AbortSignal): Promise<void> {
    this.#running = true;
    this.#lastProgress = Date.now();
    try {
      while (!signal.aborted) {
        try {
          if (!(await this.session.tryAcquire())) {
            this.#lastProgress = Date.now();
            this.#status = 'standby';
            await this.session.waitForWake(this.options.pollMs, signal);
            continue;
          }
          this.#lastProgress = Date.now();
          this.#status = this.#enqueueFailed ? 'unhealthy' : 'active';
          const claims = await this.repository.claimBatch({
            now: new Date(),
            limit: this.options.batchSize,
            leaseMs: this.options.leaseMs,
          });
          for (const claim of claims) {
            this.#lastProgress = Date.now();
            if (signal.aborted || !this.session.isLeader()) break;
            const nextAttempt = () =>
              new Date(
                Date.now() +
                  Math.min(
                    this.options.retryCapMs,
                    this.options.retryBaseMs *
                      2 ** Math.min(claim.attempts - 1, 30),
                  ),
              );
            if (!claim.job) {
              await this.repository.reschedule(
                claim.id,
                claim.claimToken,
                nextAttempt(),
                'invalid_job',
              );
              continue;
            }
            try {
              await this.producer.enqueue(claim.job, {
                timeoutMs: this.options.enqueueTimeoutMs,
              });
              this.#enqueueFailed = false;
              this.#status = 'active';
              if (!signal.aborted && this.session.isLeader())
                await this.repository.markSent(claim.id, claim.claimToken);
            } catch {
              this.#enqueueFailed = true;
              this.#status = 'unhealthy';
              if (!signal.aborted && this.session.isLeader())
                await this.repository.reschedule(
                  claim.id,
                  claim.claimToken,
                  nextAttempt(),
                );
            }
          }
          this.#lastProgress = Date.now();
          if (
            claims.length < this.options.batchSize ||
            this.#status === 'unhealthy'
          )
            await this.session.waitForWake(this.options.pollMs, signal);
        } catch {
          this.#status = 'unhealthy';
          await this.session.waitForWake(this.options.pollMs, signal);
        }
      }
    } finally {
      this.#running = false;
      this.#status = 'unhealthy';
      await this.session.close();
    }
  }
}
