import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { RunStreamEventSchema, type RunStreamEvent } from '@lexon/contracts';
import type { StepClaim, TerminalStreamReference } from '../db/index.js';
import {
  encodeStreamParts,
  encodeStreamPartsBounded,
} from './run-stream-parts.js';
import {
  FINISH_RUN_STREAM,
  PREPARE_RUN_STREAM,
  APPEND_RUN_STREAM,
  RECONCILE_RUN_STREAMS,
} from './run-stream-scripts.js';
import { StreamCapacity } from './stream-capacity.js';

export interface ActiveStreamProof {
  readonly runVersion: number;
  readonly nextSequence: number;
  readonly status: 'queued' | 'running' | 'awaiting_approval' | 'cancelling';
  readonly stepId: string;
  readonly sequence: number;
  readonly expectedVersion: number;
  readonly fence: number;
  readonly leaseUntil: Date;
}

export interface TerminalStreamProof {
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly runVersion: number;
  readonly nextSequence: number;
  readonly latestCommittedStepId: string;
  readonly latestCommittedSequence: number;
  readonly latestCommittedExpectedVersion: number;
  readonly latestCommittedFence: number;
}

export interface RunStreamAuthority {
  /** Return fresh facts from a short tenant-scoped DB read; do no Valkey I/O in it. */
  authorizeActive(claim: StepClaim): Promise<ActiveStreamProof | undefined>;
  /** Return the latest committed-step proof after PostgreSQL terminal commit. */
  authorizeTerminal(
    claim: TerminalStreamReference,
  ): Promise<TerminalStreamProof | undefined>;
  /** Inspect at most 24 registered runs using each stored K3 tenant context. */
  reconcile(
    entries: readonly RunStreamRegistryEntry[],
  ): Promise<readonly RunStreamRegistryResult[]>;
}

export interface RunStreamRegistryEntry {
  readonly runId: string;
  readonly orgId: string;
  readonly userId: string;
}

export type RunStreamRegistryResult =
  | { readonly runId: string; readonly state: 'active' }
  | { readonly runId: string; readonly state: 'missing' }
  | {
      readonly runId: string;
      readonly state: 'terminal';
      readonly claim: StepClaim;
    };

export interface RunStreamsOptions {
  readonly url: string;
  readonly prefix: string;
  readonly authority: RunStreamAuthority;
  readonly capacity?: StreamCapacity;
}

interface SerializedQueue {
  running: boolean;
  reserved: number;
  pending: Array<{
    generation: number;
    task: (generation: number) => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    discard: unknown;
  }>;
  generation: number;
}

const MAX_PENDING_PUBLICATIONS = 4;
const MAX_PARTS_PER_PUBLICATION = 32;

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);

/** A run-wide bounded stream. PostgreSQL authorization is checked before every Valkey write. */
export class RunStreams {
  readonly #client: Redis;
  readonly #prefix: string;
  readonly #authority: RunStreamAuthority;
  readonly #capacity: StreamCapacity;
  readonly #serial = new Map<string, SerializedQueue>();

  constructor(options: RunStreamsOptions) {
    if (!/^[a-zA-Z0-9:_-]{1,80}$/.test(options.prefix))
      throw new Error('Invalid run stream configuration');
    this.#prefix = `${options.prefix}:{run-streams}`;
    this.#authority = options.authority;
    this.#capacity = options.capacity ?? new StreamCapacity();
    this.#client = new Redis(options.url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      autoResendUnfulfilledCommands: false,
      retryStrategy: () => null,
      connectTimeout: 500,
      commandTimeout: 500,
    });
    this.#client.on('error', () => undefined);
  }

  async publish(
    claim: StepClaim,
    event: RunStreamEvent,
  ): Promise<'written' | 'unavailable' | 'stale'> {
    if (
      !validClaim(claim) ||
      event.runId !== claim.runId ||
      event.type === 'finish'
    )
      return 'stale';
    const reservation = this.#reserve(claim);
    if (!reservation) return 'unavailable';
    let parts: RunStreamEvent[];
    try {
      parts = encodeStreamPartsBounded(
        event,
        this.#capacity.limits.maxEventBytes,
        MAX_PARTS_PER_PUBLICATION,
      );
    } catch (error) {
      this.#releaseReservation(claim, reservation.queue);
      if (
        error instanceof Error &&
        error.message === 'Stream event exceeds part limit'
      )
        return 'unavailable';
      return 'stale';
    }
    return this.#enqueueReserved(
      claim,
      reservation,
      async (generation) => {
        for (const part of parts) {
          if (!this.#isCurrent(claim, generation)) return 'stale';
          const result = await this.#publishPart(claim, part, () =>
            this.#isCurrent(claim, generation),
          );
          if (result !== 'written') return result;
        }
        return 'written';
      },
      'stale',
    );
  }

  async finish(
    claim: TerminalStreamReference,
    event: RunStreamEvent,
  ): Promise<void> {
    if (
      !validTerminalReference(claim) ||
      event.runId !== claim.runId ||
      event.type !== 'finish' ||
      !RunStreamEventSchema.safeParse(event).success
    )
      throw new Error('Terminal stream event must use finish');
    const parts = encodeStreamParts(event, this.#capacity.limits.maxEventBytes);
    if (parts.length !== 1)
      throw new Error('Terminal stream event must be one bounded part');
    const queue = this.#queue(claim);
    this.#invalidate(queue);
    await this.#enqueue(
      claim,
      async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const epoch = await this.#readEpoch();
            if (epoch === undefined) return;
            const proof = await this.#terminalProof(claim);
            if (!proof) return;
            const candidate = await this.#terminalCandidate();
            const result = Number(
              await this.#client.eval(
                FINISH_RUN_STREAM,
                9,
                this.#activeKey(),
                this.#terminalKey(),
                this.#streamKey(claim.runId),
                this.#guardKey(claim.runId),
                candidate
                  ? this.#streamKey(candidate.runId)
                  : this.#streamKey(claim.runId),
                candidate
                  ? this.#guardKey(candidate.runId)
                  : this.#guardKey(claim.runId),
                this.#epochKey(),
                this.#contextKey(),
                this.#terminalMembersKey(),
                claim.runId,
                String(claim.expectedVersion),
                String(claim.sequence),
                String(claim.fence),
                JSON.stringify(parts[0]),
                String(this.#capacity.limits.maxEntries),
                String(this.#capacity.limits.terminalTtlSeconds),
                String(Date.now()),
                randomUUID(),
                candidate?.member ?? '',
                candidate?.guard ?? '',
                epoch,
                `${claim.orgId}|${claim.userId}`,
              ),
            );
            if (result === 1) return;
            if (result === 0) return;
          } catch {
            return;
          }
        }
      },
      true,
      undefined,
    );
  }

  async recover(
    claim: StepClaim,
    durableSnapshot: RunStreamEvent,
  ): Promise<void> {
    if (
      durableSnapshot.runId !== claim.runId ||
      durableSnapshot.type !== 'reset'
    )
      throw new Error('Invalid run stream recovery snapshot');
    if (!validClaim(claim)) return;
    const parts = encodeStreamParts(
      durableSnapshot,
      this.#capacity.limits.maxEventBytes,
    );
    const queue = this.#queue(claim);
    this.#invalidate(queue);
    await this.#enqueue(
      claim,
      async (generation) => {
        for (const part of parts) {
          if (!this.#isCurrent(claim, generation)) return;
          const result = await this.#publishPart(claim, part, () =>
            this.#isCurrent(claim, generation),
          );
          if (result !== 'written') return;
        }
      },
      true,
      undefined,
    );
  }

  async close(): Promise<void> {
    this.#client.disconnect();
  }

  async #publishPart(
    claim: StepClaim,
    event: RunStreamEvent,
    isCurrent: () => boolean,
  ): Promise<'written' | 'unavailable' | 'stale'> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const epoch = await this.#readEpoch();
        if (epoch === undefined) return 'unavailable';
        if (!isCurrent()) return 'stale';
        const proof = await this.#activeProof(claim);
        if (!proof) return 'stale';
        if (!isCurrent()) return 'stale';
        const guard = guardValue(claim);
        const existing = await this.#client.zscore(
          this.#activeKey(),
          claim.runId,
        );
        if (existing === null) {
          const reconciled = await this.#reconcileRegistry(epoch);
          if (reconciled === 'unavailable') return 'unavailable';
          if (reconciled === 'changed') continue;
        }
        if (!isCurrent()) return 'stale';
        // Recheck after bounded registry reconciliation and immediately before guard initialization.
        const latestProof = await this.#activeProof(claim);
        if (!latestProof) return 'stale';
        if (!isCurrent()) return 'stale';
        const prepared = await this.#prepare(
          claim,
          guard,
          epoch,
          latestProof.leaseUntil.getTime(),
        );
        if (prepared === -2) return 'stale';
        if (prepared === 0) return 'unavailable';
        if (prepared < 0) continue;
        if (!isCurrent()) return 'stale';
        const serialized = JSON.stringify(event);
        if (
          Buffer.byteLength(serialized, 'utf8') >
          this.#capacity.limits.maxEventBytes
        )
          return 'stale';
        const result = Number(
          await this.#client.eval(
            APPEND_RUN_STREAM,
            4,
            this.#activeKey(),
            this.#streamKey(claim.runId),
            this.#guardKey(claim.runId),
            this.#epochKey(),
            claim.runId,
            String(claim.expectedVersion),
            serialized,
            String(this.#capacity.limits.maxEntries),
            String(claim.sequence),
            String(claim.fence),
            epoch,
            String(latestProof.leaseUntil.getTime()),
          ),
        );
        if (result === 1) return 'written';
        if (result === -1 || result === -2) return 'stale';
      } catch {
        return 'unavailable';
      }
    }
    return 'unavailable';
  }

  async #prepare(
    claim: StepClaim,
    guard: string,
    epoch: string,
    leaseUntilMs: number,
  ): Promise<number> {
    const keys = [
      this.#activeKey(),
      this.#terminalKey(),
      this.#streamKey(claim.runId),
      this.#guardKey(claim.runId),
      this.#streamKey(claim.runId),
      this.#guardKey(claim.runId),
      this.#epochKey(),
      this.#contextKey(),
    ];
    return Number(
      await this.#client.eval(
        PREPARE_RUN_STREAM,
        keys.length,
        ...keys,
        claim.runId,
        String(Date.now()),
        guard,
        '',
        '',
        epoch,
        String(leaseUntilMs),
        `${claim.orgId}|${claim.userId}`,
      ),
    );
  }

  async #reconcileRegistry(
    epoch: string,
  ): Promise<'unchanged' | 'changed' | 'unavailable'> {
    try {
      const runIds = await this.#client.zrange(this.#activeKey(), '0', '23');
      if (!runIds.length) return 'unchanged';
      const contexts = await this.#client.hmget(this.#contextKey(), ...runIds);
      const entries: RunStreamRegistryEntry[] = [];
      const contextByRun = new Map<string, string>();
      for (let index = 0; index < runIds.length; index++) {
        const runId = runIds[index]!;
        const encoded = contexts[index];
        const [orgId, userId] = (encoded ?? '').split('|');
        if (
          !uuid.test(runId) ||
          !orgId ||
          !uuid.test(orgId) ||
          !userId ||
          !uuid.test(userId)
        )
          return 'unavailable';
        contextByRun.set(runId, encoded!);
        entries.push({ runId, orgId, userId });
      }
      const results = await this.#authority.reconcile(entries);
      if (results.length !== entries.length) return 'unavailable';
      const byRun = new Map(results.map((result) => [result.runId, result]));
      if (
        byRun.size !== entries.length ||
        results.some((result) => {
          const entry = entries.find(
            (candidate) => candidate.runId === result.runId,
          );
          return (
            !entry ||
            (result.state === 'terminal' &&
              (result.claim.runId !== entry.runId ||
                result.claim.orgId !== entry.orgId ||
                result.claim.userId !== entry.userId))
          );
        })
      )
        return 'unavailable';
      const stale = entries.filter((entry) => {
        const result = byRun.get(entry.runId);
        return !result || result.state === 'missing';
      });
      let changed = false;
      for (const entry of entries) {
        const result = byRun.get(entry.runId);
        if (result?.state === 'terminal') {
          await this.finish(result.claim, {
            version: 1,
            runId: entry.runId,
            type: 'finish',
          });
          if (await this.#client.zscore(this.#activeKey(), entry.runId))
            return 'unavailable';
          changed = true;
        }
      }
      if (!stale.length) return changed ? 'changed' : 'unchanged';
      const keys = [
        this.#activeKey(),
        this.#contextKey(),
        this.#epochKey(),
        ...stale.flatMap(({ runId }) => [
          this.#streamKey(runId),
          this.#guardKey(runId),
        ]),
      ];
      const args = [
        epoch,
        String(stale.length),
        ...stale.flatMap(({ runId }) => [runId, contextByRun.get(runId)!]),
      ];
      const removed = Number(
        await this.#client.eval(
          RECONCILE_RUN_STREAMS,
          keys.length,
          ...keys,
          ...args,
        ),
      );
      return removed === 1 ? 'changed' : 'changed';
    } catch {
      return 'unavailable';
    }
  }

  async #readEpoch(): Promise<string | undefined> {
    try {
      if (!(await this.#connect())) return undefined;
      await this.#client.set(this.#epochKey(), '0', 'NX');
      return (await this.#client.get(this.#epochKey())) ?? undefined;
    } catch {
      return undefined;
    }
  }

  async #connect(): Promise<boolean> {
    if (this.#client.status === 'ready') return true;
    if (this.#client.status !== 'wait' && this.#client.status !== 'end')
      return false;
    try {
      await this.#client.connect();
      return true;
    } catch {
      return false;
    }
  }

  async #terminalCandidate(): Promise<
    { member: string; runId: string; guard: string } | undefined
  > {
    let member: string | undefined;
    try {
      [member] = await this.#client.zrange(this.#terminalKey(), '0', '0');
    } catch {
      throw new Error('Run stream registry unavailable');
    }
    if (!member) return undefined;
    const runId = member.split('|', 1)[0]!;
    if (!uuid.test(runId)) return undefined;
    const guard = (await this.#client.get(this.#guardKey(runId))) ?? '';
    return { member, runId, guard };
  }

  async #activeProof(claim: StepClaim): Promise<ActiveStreamProof | undefined> {
    let proof: ActiveStreamProof | undefined;
    try {
      proof = await this.#authority.authorizeActive(claim);
    } catch {
      return undefined;
    }
    return proof &&
      proof &&
      proof.runVersion === claim.expectedVersion &&
      proof.nextSequence === claim.sequence &&
      proof.sequence === claim.sequence &&
      proof.expectedVersion === claim.expectedVersion &&
      proof.stepId === claim.stepId &&
      proof.fence === claim.fence &&
      proof.leaseUntil instanceof Date &&
      proof.leaseUntil.getTime() > Date.now() &&
      ['queued', 'running', 'awaiting_approval', 'cancelling'].includes(
        proof.status,
      )
      ? proof
      : undefined;
  }

  async #terminalProof(claim: TerminalStreamReference): Promise<boolean> {
    let proof: TerminalStreamProof | undefined;
    try {
      proof = await this.#authority.authorizeTerminal(claim);
    } catch {
      return false;
    }
    return Boolean(
      proof &&
      terminalStatuses.has(proof.status) &&
      proof.latestCommittedStepId === claim.stepId &&
      proof.latestCommittedSequence === claim.sequence &&
      proof.latestCommittedExpectedVersion === claim.expectedVersion &&
      proof.latestCommittedFence === claim.fence &&
      proof.runVersion >= claim.expectedVersion + 1 &&
      (claim.neutral === true
        ? proof.nextSequence >= claim.sequence
        : proof.nextSequence >= claim.sequence + 1),
    );
  }

  #queue(claim: TerminalStreamReference): SerializedQueue {
    const key = `${claim.orgId}:${claim.runId}:${claim.stepId}:${claim.sequence}:${claim.expectedVersion}:${claim.fence}`;
    let queue = this.#serial.get(key);
    if (!queue) {
      queue = { running: false, reserved: 0, pending: [], generation: 0 };
      this.#serial.set(key, queue);
    }
    return queue;
  }

  #isCurrent(claim: TerminalStreamReference, generation: number): boolean {
    return this.#queue(claim).generation === generation;
  }

  #enqueue<T>(
    claim: TerminalStreamReference,
    task: (generation: number) => Promise<T>,
    allowSaturated = false,
    discard: T,
  ): Promise<T> | undefined {
    const queue = this.#queue(claim);
    if (
      !allowSaturated &&
      queue.pending.length + Number(queue.running) + queue.reserved >=
        MAX_PENDING_PUBLICATIONS
    )
      return undefined;
    return this.#enqueueTask(claim, queue, queue.generation, task, discard);
  }

  #reserve(
    claim: TerminalStreamReference,
  ): { queue: SerializedQueue; generation: number } | undefined {
    const queue = this.#queue(claim);
    if (
      queue.pending.length + Number(queue.running) + queue.reserved >=
      MAX_PENDING_PUBLICATIONS
    )
      return undefined;
    queue.reserved++;
    return { queue, generation: queue.generation };
  }

  #enqueueReserved<T>(
    claim: TerminalStreamReference,
    reservation: { queue: SerializedQueue; generation: number },
    task: (generation: number) => Promise<T>,
    discard: T,
  ): Promise<T> {
    reservation.queue.reserved--;
    return this.#enqueueTask(
      claim,
      reservation.queue,
      reservation.generation,
      task,
      discard,
    );
  }

  #enqueueTask<T>(
    claim: TerminalStreamReference,
    queue: SerializedQueue,
    generation: number,
    task: (generation: number) => Promise<T>,
    discard: T,
  ): Promise<T> {
    const current = new Promise<T>((resolve, reject) => {
      queue.pending.push({
        generation,
        task: async (value) => task(value),
        resolve: (value) => resolve(value as T),
        reject,
        discard,
      });
    });
    void this.#drain(claim, queue);
    return current;
  }

  #releaseReservation(
    claim: TerminalStreamReference,
    queue: SerializedQueue,
  ): void {
    queue.reserved--;
    this.#deleteIdleQueue(claim, queue);
  }

  #invalidate(queue: SerializedQueue): void {
    queue.generation++;
    for (const pending of queue.pending.splice(0))
      pending.resolve(pending.discard);
  }

  async #drain(
    claim: TerminalStreamReference,
    queue: SerializedQueue,
  ): Promise<void> {
    if (queue.running) return;
    queue.running = true;
    while (queue.pending.length > 0) {
      const next = queue.pending.shift()!;
      try {
        next.resolve(await next.task(next.generation));
      } catch (error) {
        next.reject(error);
      }
    }
    queue.running = false;
    this.#deleteIdleQueue(claim, queue);
  }

  #deleteIdleQueue(
    claim: TerminalStreamReference,
    queue: SerializedQueue,
  ): void {
    if (!queue.running && queue.pending.length === 0 && queue.reserved === 0) {
      const key = `${claim.orgId}:${claim.runId}:${claim.stepId}:${claim.sequence}:${claim.expectedVersion}:${claim.fence}`;
      if (this.#serial.get(key) === queue) this.#serial.delete(key);
    }
  }

  #activeKey(): string {
    return `${this.#prefix}:active`;
  }
  #terminalKey(): string {
    return `${this.#prefix}:terminal`;
  }
  #terminalMembersKey(): string {
    return `${this.#prefix}:terminal-members`;
  }
  #epochKey(): string {
    return `${this.#prefix}:epoch`;
  }
  #contextKey(): string {
    return `${this.#prefix}:contexts`;
  }
  #streamKey(runId: string): string {
    return `${this.#prefix}:${runId}:events`;
  }
  #guardKey(runId: string): string {
    return `${this.#prefix}:${runId}:guard`;
  }
}

function validClaim(claim: StepClaim): boolean {
  return (
    uuid.test(claim.runId) &&
    uuid.test(claim.orgId) &&
    uuid.test(claim.userId) &&
    uuid.test(claim.stepId) &&
    Number.isSafeInteger(claim.sequence) &&
    claim.sequence > 0 &&
    Number.isSafeInteger(claim.expectedVersion) &&
    claim.expectedVersion > 0 &&
    Number.isSafeInteger(claim.fence) &&
    claim.fence > 0
  );
}

function guardValue(claim: TerminalStreamReference): string {
  return `open|${claim.expectedVersion}|${claim.sequence}|${claim.fence}`;
}

function validTerminalReference(reference: TerminalStreamReference): boolean {
  return (
    uuid.test(reference.runId) &&
    uuid.test(reference.orgId) &&
    uuid.test(reference.userId) &&
    uuid.test(reference.stepId) &&
    Number.isSafeInteger(reference.sequence) &&
    reference.sequence > 0 &&
    Number.isSafeInteger(reference.expectedVersion) &&
    reference.expectedVersion > 0 &&
    Number.isSafeInteger(reference.fence) &&
    (reference.fence > 0 ||
      (reference.neutral === true && reference.fence === 0))
  );
}
