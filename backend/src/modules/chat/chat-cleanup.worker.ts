import { randomUUID } from 'node:crypto';
import type {
  JobEnvelope,
  TenantDatabase,
} from '../../infrastructure/db/index.js';
import { ChatDeletionRepository } from '../../infrastructure/db/index.js';
import { RunStreams } from '../../infrastructure/queue/run-streams.js';
import { StepPermitManager } from '../../infrastructure/queue/step-permits.js';
import { AuditService } from '../audit/index.js';

export interface ChatCleanupClock {
  now(): number;
}

export interface ChatCleanupMetric {
  readonly event: 'retry' | 'complete';
  readonly phase: string;
  readonly elapsedMs: number;
  readonly overdueMs: number;
}

export interface ChatCleanupObserver {
  record(metric: ChatCleanupMetric): void;
}

export interface ChatCleanupOptions {
  readonly targetMs: number;
  readonly observer?: ChatCleanupObserver;
}

export class ChatCleanupWorker {
  private readonly deletions = new ChatDeletionRepository();
  private readonly audit = new AuditService();

  constructor(
    private readonly database: TenantDatabase,
    private readonly streams: RunStreams,
    private readonly permits: StepPermitManager,
    private readonly clock: ChatCleanupClock = { now: () => Date.now() },
    private readonly options: ChatCleanupOptions = { targetMs: 60_000 },
  ) {}

  async advance(job: JobEnvelope): Promise<'pending' | 'complete'> {
    if (job.type !== 'chat.cleanup.v1' || !job.ctx.userId)
      throw new Error('Invalid chat cleanup job');
    const ctx = { orgId: job.ctx.orgId, userId: job.ctx.userId };
    const phase = job.payload.phase ?? 'grace';
    const order = ['grace', 'purge_db', 'purge_valkey', 'complete'] as const;
    const work = await this.database.withTenant(ctx, async (tx) => {
      const current = await this.deletions.read(tx, job.payload.chatId, true);
      if (!current) return null;
      if (current.phase === 'complete') return current;
      if (order.indexOf(current.phase) > order.indexOf(phase)) return null;
      if (order.indexOf(current.phase) < order.indexOf(phase)) return current;
      if (current.phase === 'grace') {
        if (this.clock.now() < current.graceUntil.getTime()) return current;
        await this.deletions.moveToNextPhase(
          tx,
          current.chatId,
          'grace',
          'purge_db',
        );
        return current;
      }
      if (current.phase === 'purge_db') {
        if (!(await this.deletions.purgeContent(tx, current.chatId)))
          throw new Error('Chat cleanup database purge failed');
        await this.deletions.moveToNextPhase(
          tx,
          current.chatId,
          'purge_db',
          'purge_valkey',
        );
        return current;
      }
      return current;
    });
    if (!work || work.phase === 'complete') {
      if (work) this.#record('complete', work.phase, work.requestedAt);
      return 'complete';
    }
    if (work.phase === 'grace' || work.phase === 'purge_db') {
      this.#record('retry', work.phase, work.requestedAt);
      return 'pending';
    }
    if (phase !== 'purge_valkey') {
      this.#record('retry', work.phase, work.requestedAt);
      return 'pending';
    }

    for (const reference of work.permitRefs) {
      const released = await this.permits.releaseReference(reference);
      if (released === 'unavailable') {
        this.#record('retry', work.phase, work.requestedAt);
        return 'pending';
      }
    }
    try {
      await this.streams.removeRuns(work.runIds);
    } catch {
      this.#record('retry', work.phase, work.requestedAt);
      return 'pending';
    }

    const result = await this.database.withTenant(ctx, async (tx) => {
      const current = await this.deletions.read(tx, job.payload.chatId, true);
      if (!current || current.phase === 'complete') return 'complete';
      if (current.phase !== 'purge_valkey') return 'pending';
      if (!(await this.deletions.complete(tx, current.chatId)))
        return 'pending';
      await this.audit.append(tx, {
        version: 1,
        eventId: randomUUID(),
        type: 'chat.deletion_completed.v1',
        occurredAt: new Date(this.clock.now()).toISOString(),
        outcome: 'success',
        orgId: current.orgId,
        actorUserId: current.ownerUserId,
        metadata: { chatId: current.chatId },
      });
      return 'complete';
    });
    this.#record(
      result === 'complete' ? 'complete' : 'retry',
      work.phase,
      work.requestedAt,
    );
    return result;
  }

  #record(
    event: ChatCleanupMetric['event'],
    phase: string,
    requestedAt: Date,
  ): void {
    const elapsedMs = Math.max(0, this.clock.now() - requestedAt.getTime());
    this.options.observer?.record({
      event,
      phase,
      elapsedMs,
      overdueMs: Math.max(0, elapsedMs - this.options.targetMs),
    });
  }

  async close(): Promise<void> {
    await this.permits.close();
  }
}
