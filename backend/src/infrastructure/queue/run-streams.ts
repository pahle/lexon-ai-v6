import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Redis } from 'ioredis';
import {
  RunErrorCodeSchema,
  RunStreamEventSchema,
  type RunStreamEvent,
} from '@lexon/contracts';
import type {
  CommittedStreamReference,
  StepClaim,
  TerminalStreamReference,
} from '../db/index.js';
import {
  encodeStreamParts,
  encodeStreamPartsBounded,
} from './run-stream-parts.js';
import {
  FINISH_RUN_STREAM,
  PREPARE_RUN_STREAM,
  APPEND_RUN_STREAM,
  APPEND_COMMITTED_RUN_STREAM,
  RECONCILE_RUN_STREAMS,
  DELETE_RUN_STREAMS,
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
  readonly streamGeneration?: number;
}

export interface TerminalStreamProof {
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly errorCode?: string;
  readonly runVersion: number;
  readonly nextSequence: number;
  readonly latestCommittedStepId: string;
  readonly latestCommittedSequence: number;
  readonly latestCommittedExpectedVersion: number;
  readonly latestCommittedFence: number;
  readonly streamGeneration?: number;
}

export interface CommittedStreamProof {
  readonly status:
    'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
  readonly runVersion: number;
  readonly nextSequence: number;
  readonly stepId: string;
  readonly sequence: number;
  readonly expectedVersion: number;
  readonly fence: number;
  readonly streamGeneration: number;
}

export interface RunStreamAuthority {
  /** Return fresh facts from a short tenant-scoped DB read; do no Valkey I/O in it. */
  authorizeActive(claim: StepClaim): Promise<ActiveStreamProof | undefined>;
  /** Return the latest committed-step proof after PostgreSQL terminal commit. */
  authorizeTerminal(
    claim: TerminalStreamReference,
  ): Promise<TerminalStreamProof | undefined>;
  /** Return fresh lineage proof for a committed operation/approval/status event. */
  authorizeCommitted?(
    claim: CommittedStreamReference,
    event: RunStreamEvent,
  ): Promise<CommittedStreamProof | undefined>;
  /** Inspect at most 24 registered runs using each stored K3 tenant context. */
  reconcile(
    entries: readonly RunStreamRegistryEntry[],
  ): Promise<readonly RunStreamRegistryResult[]>;
  advanceStreamGeneration?(
    claim: StepClaim,
    observed: number,
  ): Promise<number | undefined>;
  advanceTerminalStreamGeneration?(
    claim: TerminalStreamReference,
    observed: number,
  ): Promise<number | undefined>;
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
      readonly claim: TerminalStreamReference;
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
const PUBLICATION_DEADLINE_MS = 250;
// More than four publication deadlines; a fresh publication always rechecks PostgreSQL.
const DELETED_RUN_STREAM_FENCE_TTL_SECONDS = 2;

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
    return (await this.publishWithCursor(claim, event)).status;
  }

  async publishWithCursor(
    claim: StepClaim,
    event: RunStreamEvent,
  ): Promise<{
    readonly status: 'written' | 'unavailable' | 'stale';
    readonly eventId?: string;
    readonly generation: number;
  }> {
    const deadlineAt = performance.now() + PUBLICATION_DEADLINE_MS;
    if (
      !validClaim(claim) ||
      event.runId !== claim.runId ||
      event.type === 'finish'
    )
      return { status: 'stale', generation: 0 };
    const reservation = this.#reserve(claim);
    if (!reservation) return { status: 'unavailable', generation: 0 };
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
        return { status: 'unavailable', generation: 0 };
      return { status: 'stale', generation: 0 };
    }
    return this.#enqueueReserved(
      claim,
      reservation,
      async (generation) => {
        const serverDeadlineAt = await this.#serverDeadline(deadlineAt);
        if (serverDeadlineAt === undefined)
          return { status: 'unavailable' as const, generation };
        let eventId: string | undefined;
        let durableGeneration = 0;
        for (const part of parts) {
          if (performance.now() >= deadlineAt)
            return { status: 'unavailable' as const, generation };
          if (!this.#isCurrent(claim, generation))
            return { status: 'stale' as const, generation };
          const result = await this.#publishPart(
            claim,
            part,
            () => this.#isCurrent(claim, generation),
            deadlineAt,
            serverDeadlineAt,
          );
          if (result.status !== 'written')
            return { status: result.status, generation };
          eventId = result.eventId;
          durableGeneration = result.generation ?? durableGeneration;
        }
        return {
          status: 'written' as const,
          ...(eventId ? { eventId } : {}),
          generation: durableGeneration,
        };
      },
      { status: 'unavailable', generation: 0 },
      deadlineAt,
    );
  }

  async finish(
    claim: TerminalStreamReference,
    event: RunStreamEvent,
    options: { readonly resetToSnapshot?: boolean } = {},
  ): Promise<void> {
    const deadlineAt = performance.now() + PUBLICATION_DEADLINE_MS;
    await this.#finishWithinDeadline(claim, event, options, deadlineAt);
  }

  async #finishWithinDeadline(
    claim: TerminalStreamReference,
    event: RunStreamEvent,
    options: { readonly resetToSnapshot?: boolean },
    deadlineAt: number,
    serverDeadlineAt?: number,
    alreadyQueued = false,
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
    if (performance.now() >= deadlineAt) return;
    const queue = this.#queue(claim);
    const write = async () => {
      const writeDeadlineAt =
        serverDeadlineAt ?? (await this.#serverDeadline(deadlineAt));
      if (writeDeadlineAt === undefined) return;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (performance.now() >= deadlineAt) return;
        try {
          const epoch = await this.#readEpoch();
          if (epoch === undefined) return;
          const proof = await this.#terminalProof(claim);
          if (!proof) return;
          const streamExists =
            (await this.#client.exists(this.#streamKey(claim.runId))) > 0;
          let streamGeneration = proof.streamGeneration ?? 0;
          if (!Number.isSafeInteger(streamGeneration) || streamGeneration < 0)
            return;
          if (
            !streamExists &&
            this.#authority.advanceTerminalStreamGeneration
          ) {
            const advanced =
              await this.#authority.advanceTerminalStreamGeneration(
                claim,
                streamGeneration,
              );
            if (advanced === undefined) return;
            streamGeneration = advanced;
          }
          const candidate = await this.#terminalCandidate();
          if (performance.now() >= deadlineAt) return;
          const statusEvent: RunStreamEvent = {
            version: 1,
            runId: claim.runId,
            type: 'status',
            status: proof.status,
          };
          const safeCode = RunErrorCodeSchema.safeParse(proof.errorCode);
          const errorEvent: RunStreamEvent | undefined = safeCode.success
            ? {
                version: 1,
                runId: claim.runId,
                type: 'error',
                code: safeCode.data,
              }
            : undefined;
          const result = Number(
            await this.#client.eval(
              FINISH_RUN_STREAM,
              11,
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
              this.#generationKey(claim.runId),
              candidate
                ? this.#generationKey(candidate.runId)
                : this.#generationKey(claim.runId),
              claim.runId,
              String(proof.runVersion),
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
              options.resetToSnapshot === true ? '1' : '0',
              JSON.stringify(statusEvent),
              errorEvent ? JSON.stringify(errorEvent) : '',
              String(writeDeadlineAt),
              String(streamGeneration),
            ),
          );
          if (result === 1) return;
          if (result === 0) return;
        } catch {
          return;
        }
      }
    };
    this.#invalidate(queue);
    if (alreadyQueued) {
      await write();
      return;
    }
    await this.#enqueue(claim, write, true, undefined, deadlineAt);
  }

  async publishCommitted(
    claim: CommittedStreamReference,
    events: readonly RunStreamEvent[],
  ): Promise<'written' | 'unavailable' | 'stale'> {
    const deadlineAt = performance.now() + PUBLICATION_DEADLINE_MS;
    if (
      !validCommittedReference(claim) ||
      events.length < 1 ||
      events.length > 32
    )
      return 'stale';
    let parts: RunStreamEvent[];
    try {
      parts = events.flatMap((event) => {
        if (event.runId !== claim.runId || event.type === 'finish')
          throw new Error('Invalid committed stream event');
        return encodeStreamPartsBounded(
          event,
          this.#capacity.limits.maxEventBytes,
          MAX_PARTS_PER_PUBLICATION,
        );
      });
    } catch {
      return 'stale';
    }
    const result = await this.#enqueue(
      claim,
      async (generation) => {
        const serverDeadlineAt = await this.#serverDeadline(deadlineAt);
        if (serverDeadlineAt === undefined) return 'unavailable';
        for (const part of parts) {
          if (performance.now() >= deadlineAt) return 'unavailable';
          if (!this.#isCurrent(claim, generation)) return 'stale';
          const written = await this.#publishCommittedPart(
            claim,
            part,
            deadlineAt,
            serverDeadlineAt,
          );
          if (written !== 'written') return written;
        }
        return 'written';
      },
      false,
      'unavailable',
      deadlineAt,
    );
    return result ?? 'unavailable';
  }

  async recover(
    claim: StepClaim,
    durableSnapshot: RunStreamEvent,
  ): Promise<'written' | 'unavailable' | 'stale'> {
    if (
      durableSnapshot.runId !== claim.runId ||
      durableSnapshot.type !== 'reset'
    )
      throw new Error('Invalid run stream recovery snapshot');
    if (!validClaim(claim)) return 'stale';
    const deadlineAt = performance.now() + PUBLICATION_DEADLINE_MS;
    const parts = encodeStreamParts(
      durableSnapshot,
      this.#capacity.limits.maxEventBytes,
    );
    const queue = this.#queue(claim);
    this.#invalidate(queue);
    return (
      (await this.#enqueue(
        claim,
        async (generation) => {
          const serverDeadlineAt = await this.#serverDeadline(deadlineAt);
          if (serverDeadlineAt === undefined) return 'unavailable';
          for (const part of parts) {
            if (!this.#isCurrent(claim, generation)) return 'stale';
            const result = await this.#publishPart(
              claim,
              part,
              () => this.#isCurrent(claim, generation),
              deadlineAt,
              serverDeadlineAt,
            );
            if (result.status !== 'written') return result.status;
          }
          return 'written';
        },
        true,
        'unavailable',
        deadlineAt,
      )) ?? 'unavailable'
    );
  }

  async close(): Promise<void> {
    this.#client.disconnect();
  }

  async removeRuns(runIds: readonly string[]): Promise<void> {
    if (runIds.some((runId) => !uuid.test(runId)))
      throw new Error('Invalid run stream deletion');
    if (runIds.length === 0) return;
    if (!(await this.#connect()))
      throw new Error('Run stream store unavailable');
    const uniqueRunIds = [...new Set(runIds)];
    const keys = [
      this.#activeKey(),
      this.#terminalKey(),
      this.#contextKey(),
      this.#terminalMembersKey(),
      ...uniqueRunIds.flatMap((runId) => [
        this.#streamKey(runId),
        this.#guardKey(runId),
        this.#generationKey(runId),
      ]),
    ];
    await this.#client.eval(
      DELETE_RUN_STREAMS,
      keys.length,
      ...keys,
      String(DELETED_RUN_STREAM_FENCE_TTL_SECONDS),
      ...uniqueRunIds,
    );
    for (const [key, queue] of this.#serial) {
      if (uniqueRunIds.includes(key.split(':')[1] ?? '')) {
        this.#invalidate(queue);
        this.#serial.delete(key);
      }
    }
  }

  async #publishPart(
    claim: StepClaim,
    event: RunStreamEvent,
    isCurrent: () => boolean,
    deadlineAt: number,
    serverDeadlineAt: number,
  ): Promise<{
    readonly status: 'written' | 'unavailable' | 'stale';
    readonly eventId?: string;
    readonly generation?: number;
  }> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (performance.now() >= deadlineAt) return { status: 'unavailable' };
      try {
        const epoch = await this.#readEpoch();
        if (epoch === undefined) return { status: 'unavailable' };
        if (performance.now() >= deadlineAt) return { status: 'unavailable' };
        if (!isCurrent()) return { status: 'stale' };
        const proof = await this.#activeProof(claim);
        if (!proof) return { status: 'stale' };
        if (!isCurrent()) return { status: 'stale' };
        const streamExists =
          (await this.#client.exists(this.#streamKey(claim.runId))) > 0;
        let streamGeneration = proof.streamGeneration ?? 0;
        if (!Number.isSafeInteger(streamGeneration) || streamGeneration < 0)
          return { status: 'stale' };
        if (!streamExists && this.#authority.advanceStreamGeneration) {
          const advanced = await this.#authority.advanceStreamGeneration(
            claim,
            streamGeneration,
          );
          if (advanced === undefined) return { status: 'stale' };
          streamGeneration = advanced;
        }
        const guard = guardValue(claim);
        const existing = await this.#client.zscore(
          this.#activeKey(),
          claim.runId,
        );
        if (existing === null) {
          const reconciled = await this.#reconcileRegistry(
            epoch,
            deadlineAt,
            serverDeadlineAt,
          );
          if (reconciled === 'unavailable') return { status: 'unavailable' };
          if (reconciled === 'changed') continue;
        }
        if (!isCurrent()) return { status: 'stale' };
        // Recheck after bounded registry reconciliation and immediately before guard initialization.
        const latestProof = await this.#activeProof(claim);
        if (!latestProof) return { status: 'stale' };
        if (!isCurrent()) return { status: 'stale' };
        const prepared = await this.#prepare(
          claim,
          guard,
          epoch,
          latestProof.leaseUntil.getTime(),
          serverDeadlineAt,
        );
        if (prepared === -2) return { status: 'stale' };
        if (prepared === -4) return { status: 'stale' };
        if (prepared === -3 || prepared === 0) return { status: 'unavailable' };
        if (prepared < 0) continue;
        if (!isCurrent()) return { status: 'stale' };
        if (performance.now() >= deadlineAt) return { status: 'unavailable' };
        const serialized = JSON.stringify(event);
        if (
          Buffer.byteLength(serialized, 'utf8') >
          this.#capacity.limits.maxEventBytes
        )
          return { status: 'stale' };
        const rawResult = await this.#client.eval(
          APPEND_RUN_STREAM,
          5,
          this.#activeKey(),
          this.#streamKey(claim.runId),
          this.#guardKey(claim.runId),
          this.#epochKey(),
          this.#generationKey(claim.runId),
          claim.runId,
          String(claim.expectedVersion),
          serialized,
          String(this.#capacity.limits.maxEntries),
          String(claim.sequence),
          String(claim.fence),
          epoch,
          String(latestProof.leaseUntil.getTime()),
          String(serverDeadlineAt),
          event.type,
          event.type === 'text-start' || event.type === 'text-end'
            ? event.id
            : '',
          String(streamGeneration),
        );
        if (typeof rawResult === 'string' && /^\d+-\d+$/.test(rawResult))
          return {
            status: 'written',
            eventId: rawResult,
            generation: streamGeneration,
          };
        if (Number(rawResult) === 1)
          return { status: 'written', generation: streamGeneration };
        const result = Number(rawResult);
        if (result === -1 || result === -2) return { status: 'stale' };
        if (result === -3) return { status: 'unavailable' };
      } catch {
        return { status: 'unavailable' };
      }
    }
    return { status: 'unavailable' };
  }

  async #publishCommittedPart(
    claim: CommittedStreamReference,
    event: RunStreamEvent,
    deadlineAt: number,
    serverDeadlineAt: number,
  ): Promise<'written' | 'unavailable' | 'stale'> {
    if (performance.now() >= deadlineAt) return 'unavailable';
    try {
      const epoch = await this.#readEpoch();
      if (!epoch) return 'unavailable';
      if (performance.now() >= deadlineAt) return 'unavailable';
      const proof = await this.#authority.authorizeCommitted?.(claim, event);
      if (
        !proof ||
        proof.stepId !== claim.stepId ||
        proof.sequence !== claim.sequence ||
        proof.expectedVersion !== claim.expectedVersion ||
        proof.fence !== claim.fence ||
        proof.runVersion !== claim.committedRunVersion ||
        proof.status !== claim.committedStatus ||
        proof.nextSequence < claim.sequence + 1 ||
        !Number.isSafeInteger(proof.streamGeneration) ||
        proof.streamGeneration < 0
      )
        return 'stale';
      if (performance.now() >= deadlineAt) return 'unavailable';
      const serialized = JSON.stringify(event);
      if (
        Buffer.byteLength(serialized, 'utf8') >
        this.#capacity.limits.maxEventBytes
      )
        return 'stale';
      const result = Number(
        await this.#client.eval(
          APPEND_COMMITTED_RUN_STREAM,
          5,
          this.#streamKey(claim.runId),
          this.#guardKey(claim.runId),
          this.#epochKey(),
          this.#contextKey(),
          this.#generationKey(claim.runId),
          claim.runId,
          String(claim.committedRunVersion),
          serialized,
          String(this.#capacity.limits.maxEntries),
          epoch,
          `${claim.orgId}|${claim.userId}`,
          String(serverDeadlineAt),
          String(claim.sequence),
          String(claim.fence),
          String(proof.streamGeneration),
        ),
      );
      if (result === 1) return 'written';
      if (result === -3) return 'unavailable';
      return 'stale';
    } catch {
      return 'unavailable';
    }
  }

  async #prepare(
    claim: StepClaim,
    guard: string,
    epoch: string,
    leaseUntilMs: number,
    serverDeadlineAt: number,
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
        String(serverDeadlineAt),
      ),
    );
  }

  async #reconcileRegistry(
    epoch: string,
    clientDeadlineAt: number,
    serverDeadlineAt: number,
  ): Promise<'unchanged' | 'changed' | 'unavailable'> {
    try {
      if (performance.now() >= clientDeadlineAt) return 'unavailable';
      const runIds = await this.#client.zrange(this.#activeKey(), '0', '23');
      if (performance.now() >= clientDeadlineAt) return 'unavailable';
      if (!runIds.length) return 'unchanged';
      const contexts = await this.#client.hmget(this.#contextKey(), ...runIds);
      if (performance.now() >= clientDeadlineAt) return 'unavailable';
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
      if (performance.now() >= clientDeadlineAt) return 'unavailable';
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
          await this.#finishWithinDeadline(
            result.claim,
            { version: 1, runId: entry.runId, type: 'finish' },
            {},
            clientDeadlineAt,
            serverDeadlineAt,
            true,
          );
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
          this.#generationKey(runId),
        ]),
      ];
      const args = [
        epoch,
        String(stale.length),
        String(serverDeadlineAt),
        ...stale.flatMap(({ runId }) => [runId, contextByRun.get(runId)!]),
      ];
      const removed = Number(
        await this.#client.eval(
          RECONCILE_RUN_STREAMS,
          keys.length,
          ...keys,
          ...args,
          String(serverDeadlineAt),
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
      return (await this.#client.get(this.#epochKey())) ?? '0';
    } catch {
      return undefined;
    }
  }

  #serverDeadline(clientDeadlineAt: number): Promise<number | undefined> {
    return new Promise((resolve) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const settle = (value: number | undefined) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const expire = () => {
        const remaining = clientDeadlineAt - performance.now();
        if (remaining > 0) {
          timer = setTimeout(expire, remaining);
          return;
        }
        settle(undefined);
      };
      timer = setTimeout(
        expire,
        Math.max(0, clientDeadlineAt - performance.now()),
      );
      void Promise.resolve()
        .then(async () => {
          if (!(await this.#connect()) || performance.now() >= clientDeadlineAt)
            throw new Error(
              'Stream writer deadline expired before Valkey TIME',
            );
          return await this.#client.time();
        })
        .then(
          ([seconds, micros]) => {
            const remaining = clientDeadlineAt - performance.now();
            if (remaining <= 0) {
              settle(undefined);
              return;
            }
            const serverNowMs =
              Number(seconds) * 1000 + Math.floor(Number(micros) / 1000);
            const serverDeadlineAt = Math.floor(serverNowMs + remaining);
            settle(
              Number.isSafeInteger(serverDeadlineAt)
                ? serverDeadlineAt
                : undefined,
            );
          },
          () => settle(undefined),
        );
    });
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

  async #terminalProof(
    claim: TerminalStreamReference,
  ): Promise<TerminalStreamProof | undefined> {
    let proof: TerminalStreamProof | undefined;
    try {
      proof = await this.#authority.authorizeTerminal(claim);
    } catch {
      return undefined;
    }
    return proof &&
      terminalStatuses.has(proof.status) &&
      proof.latestCommittedStepId === claim.stepId &&
      proof.latestCommittedSequence === claim.sequence &&
      proof.latestCommittedExpectedVersion === claim.expectedVersion &&
      proof.latestCommittedFence === claim.fence &&
      proof.runVersion >= claim.expectedVersion + 1 &&
      (claim.neutral === true
        ? proof.nextSequence >= claim.sequence
        : proof.nextSequence >= claim.sequence + 1)
      ? proof
      : undefined;
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
    deadlineAt?: number,
  ): Promise<T> | undefined {
    const queue = this.#queue(claim);
    if (
      !allowSaturated &&
      queue.pending.length + Number(queue.running) + queue.reserved >=
        MAX_PENDING_PUBLICATIONS
    )
      return undefined;
    return this.#enqueueTask(
      claim,
      queue,
      queue.generation,
      task,
      discard,
      deadlineAt,
    );
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
    deadlineAt?: number,
  ): Promise<T> {
    reservation.queue.reserved--;
    return this.#enqueueTask(
      claim,
      reservation.queue,
      reservation.generation,
      task,
      discard,
      deadlineAt,
    );
  }

  #enqueueTask<T>(
    claim: TerminalStreamReference,
    queue: SerializedQueue,
    generation: number,
    task: (generation: number) => Promise<T>,
    discard: T,
    deadlineAt?: number,
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
    if (deadlineAt === undefined) return current;
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const settle = (work: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        work();
      };
      const expire = () => {
        const remaining = deadlineAt - performance.now();
        if (remaining > 0) {
          timer = setTimeout(expire, remaining);
          return;
        }
        this.#invalidate(queue);
        settle(() => resolve(discard));
      };
      timer = setTimeout(expire, Math.max(0, deadlineAt - performance.now()));
      current.then(
        (value) => settle(() => resolve(value)),
        (error: unknown) => settle(() => reject(error)),
      );
    });
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
  #generationKey(runId: string): string {
    return `${this.#prefix}:${runId}:generation`;
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

function validCommittedReference(reference: CommittedStreamReference): boolean {
  return (
    validTerminalReference(reference) &&
    Number.isSafeInteger(reference.committedRunVersion) &&
    reference.committedRunVersion >= reference.expectedVersion + 1 &&
    [
      'running',
      'awaiting_approval',
      'completed',
      'failed',
      'cancelled',
    ].includes(reference.committedStatus)
  );
}
