import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { RunStreamEventSchema, type RunStreamEvent } from '@lexon/contracts';
import type { StepClaim } from '../db/index.js';
import { encodeStreamParts } from './run-stream-parts.js';
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
  authorizeTerminal(claim: StepClaim): Promise<TerminalStreamProof | undefined>;
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

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);

/** A run-wide bounded stream. PostgreSQL authorization is checked before every Valkey write. */
export class RunStreams {
  readonly #client: Redis;
  readonly #prefix: string;
  readonly #authority: RunStreamAuthority;
  readonly #capacity: StreamCapacity;
  readonly #serial = new Map<string, Promise<unknown>>();

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
      !RunStreamEventSchema.safeParse(event).success
    )
      return 'stale';
    let parts: RunStreamEvent[];
    try {
      parts = encodeStreamParts(event, this.#capacity.limits.maxEventBytes);
    } catch {
      return 'stale';
    }
    return this.#serialized(claim, async () => {
      for (const part of parts) {
        const result = await this.#publishPart(claim, part);
        if (result !== 'written') return result;
      }
      return 'written';
    });
  }

  async finish(claim: StepClaim, event: RunStreamEvent): Promise<void> {
    if (
      !validClaim(claim) ||
      event.runId !== claim.runId ||
      !RunStreamEventSchema.safeParse(event).success
    )
      return;
    const parts = encodeStreamParts(event, this.#capacity.limits.maxEventBytes);
    if (parts.length !== 1)
      throw new Error('Terminal stream event must be one bounded part');
    await this.#serialized(claim, async () => {
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
              8,
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
    });
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
    const result = await this.publish(claim, durableSnapshot);
    if (result === 'unavailable') return;
    if (result === 'stale') return;
  }

  async close(): Promise<void> {
    this.#client.disconnect();
  }

  async #publishPart(
    claim: StepClaim,
    event: RunStreamEvent,
  ): Promise<'written' | 'unavailable' | 'stale'> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const epoch = await this.#readEpoch();
      if (epoch === undefined) return 'unavailable';
      const proof = await this.#activeProof(claim);
      if (!proof) return 'stale';
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
      // Recheck after bounded registry reconciliation and immediately before guard initialization.
      const latestProof = await this.#activeProof(claim);
      if (!latestProof) return 'stale';
      let prepared: number;
      try {
        prepared = await this.#prepare(
          claim,
          guard,
          epoch,
          latestProof.leaseUntil.getTime(),
        );
      } catch {
        return 'unavailable';
      }
      if (prepared === -2) return 'unavailable';
      if (prepared === 0) return 'unavailable';
      if (prepared < 0) continue;
      const serialized = JSON.stringify(event);
      if (
        Buffer.byteLength(serialized, 'utf8') >
        this.#capacity.limits.maxEventBytes
      )
        return 'stale';
      let result: number;
      try {
        result = Number(
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
          ),
        );
      } catch {
        return 'unavailable';
      }
      if (result === 1) return 'written';
      if (result === -1) continue;
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

  async #terminalProof(claim: StepClaim): Promise<boolean> {
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
      proof.nextSequence >= claim.sequence + 1,
    );
  }

  #serialized<T>(claim: StepClaim, task: () => Promise<T>): Promise<T> {
    const key = `${claim.orgId}:${claim.runId}:${claim.stepId}:${claim.sequence}:${claim.expectedVersion}:${claim.fence}`;
    const prior = this.#serial.get(key) ?? Promise.resolve();
    const current = prior.then(task, task);
    this.#serial.set(key, current);
    void current.then(
      () => {
        if (this.#serial.get(key) === current) this.#serial.delete(key);
      },
      () => {
        if (this.#serial.get(key) === current) this.#serial.delete(key);
      },
    );
    return current;
  }

  #activeKey(): string {
    return `${this.#prefix}:active`;
  }
  #terminalKey(): string {
    return `${this.#prefix}:terminal`;
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

function guardValue(claim: StepClaim): string {
  return `open|${claim.expectedVersion}|${claim.sequence}|${claim.fence}`;
}
