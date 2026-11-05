import type {
  JobHandlerRegistry,
  QueueJobHandler,
} from '../../infrastructure/queue/job-contracts.js';

const jobTypePattern = /^[a-z][a-z0-9.-]{0,127}$/;

/** Application-owned dispatch map; queue infrastructure only consumes its contract. */
export class JobRegistry implements JobHandlerRegistry {
  readonly #handlers = new Map<string, QueueJobHandler>();

  register(type: string, handler: QueueJobHandler): void {
    if (
      !jobTypePattern.test(type) ||
      (handler.strategy !== 'short-transaction' &&
        handler.strategy !== 'durable-step') ||
      typeof handler.handle !== 'function'
    )
      throw new Error('Invalid job registration');
    if (this.#handlers.has(type)) throw new Error('Duplicate job type');
    Object.freeze(handler);
    this.#handlers.set(type, handler);
  }

  resolve(type: string): QueueJobHandler {
    const handler = this.#handlers.get(type);
    if (!handler) throw new Error('Unknown job type');
    return handler;
  }
}
