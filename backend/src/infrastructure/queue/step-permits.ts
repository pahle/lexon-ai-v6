import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { z } from 'zod';
import type { StepPermitOwner, StepPermitReference } from '../db/index.js';

const orgIdSchema = z.uuid();
const DEFAULT_LEASE_MS = 30_000;
const MAX_ORG_SLOTS = 2;

export interface StepPermitOptions {
  url: string;
  prefix: string;
  leaseMs?: number;
}

export interface StepPermit {
  readonly orgId: string;
  readonly slot: number;
  readonly leaseMs: number;
  readonly ownerReference: StepPermitOwner;
  renew(): Promise<StepPermitRenewal>;
  release(): Promise<boolean>;
  releaseChecked(): Promise<'released' | 'lost' | 'unavailable'>;
}

export type StepPermitRenewal = 'renewed' | 'lost' | 'unavailable';

/** Two bounded, owner-fenced execution slots per organization. */
export class StepPermitManager {
  readonly #client: Redis;
  readonly #prefix: string;
  readonly #leaseMs: number;

  private constructor(options: StepPermitOptions) {
    if (
      !/^[a-zA-Z0-9:_-]{1,96}$/.test(options.prefix) ||
      (options.leaseMs !== undefined &&
        (!Number.isSafeInteger(options.leaseMs) || options.leaseMs < 100))
    )
      throw new Error('Invalid step permit configuration');
    this.#prefix = `${options.prefix}:ai-step`;
    this.#leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.#client = new Redis(options.url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      autoResendUnfulfilledCommands: false,
      retryStrategy: (attempt) => Math.min(attempt * 100, 1000),
      connectTimeout: 1000,
      commandTimeout: 1000,
    });
    this.#client.on('error', () => undefined);
  }

  static async create(options: StepPermitOptions): Promise<StepPermitManager> {
    const manager = new StepPermitManager(options);
    try {
      await manager.#client.connect();
      return manager;
    } catch {
      manager.#client.disconnect();
      throw new Error('Step permit store unavailable');
    }
  }

  get leaseMs(): number {
    return this.#leaseMs;
  }

  async releaseReference(
    reference: StepPermitReference,
  ): Promise<'released' | 'lost' | 'unavailable'> {
    if (
      !orgIdSchema.safeParse(reference.orgId).success ||
      !Number.isSafeInteger(reference.slot) ||
      reference.slot < 0 ||
      reference.slot >= MAX_ORG_SLOTS ||
      !orgIdSchema.safeParse(reference.runId).success ||
      !orgIdSchema.safeParse(reference.stepId).success ||
      !orgIdSchema.safeParse(reference.ownerToken).success ||
      !Number.isSafeInteger(reference.sequence) ||
      reference.sequence < 1 ||
      !Number.isSafeInteger(reference.expectedVersion) ||
      reference.expectedVersion < 1 ||
      !Number.isSafeInteger(reference.fence) ||
      reference.fence < 1
    )
      return 'lost';
    return this.#releaseOwner(
      reference.orgId,
      reference.slot,
      reference.ownerToken,
    );
  }

  async acquire(orgId: string): Promise<StepPermit | null> {
    if (!orgIdSchema.safeParse(orgId).success)
      throw new Error('Invalid step permit organization');
    for (let slot = 0; slot < MAX_ORG_SLOTS; slot++) {
      const key = `${this.#prefix}:${orgId}:${slot}`;
      const owner = randomUUID();
      try {
        const result = await this.#client.set(
          key,
          owner,
          'PX',
          this.#leaseMs,
          'NX',
        );
        if (result === 'OK') return this.#lease(orgId, slot, key, owner);
      } catch {
        return null;
      }
    }
    return null;
  }

  async close(): Promise<void> {
    this.#client.disconnect();
  }

  #lease(orgId: string, slot: number, key: string, owner: string): StepPermit {
    let released = false;
    return Object.freeze({
      orgId,
      slot,
      leaseMs: this.#leaseMs,
      ownerReference: Object.freeze({ orgId, slot, ownerToken: owner }),
      renew: async () => {
        if (released) return 'lost';
        try {
          const result = await this.#client.call(
            'SET',
            key,
            owner,
            'IFEQ',
            owner,
            'PX',
            String(this.#leaseMs),
          );
          return result === 'OK' ? 'renewed' : 'lost';
        } catch {
          return 'unavailable';
        }
      },
      releaseChecked: async () => {
        if (released) return 'lost';
        released = true;
        return this.#releaseOwner(orgId, slot, owner);
      },
      release: async () => {
        if (released) return false;
        released = true;
        return (await this.#releaseOwner(orgId, slot, owner)) === 'released';
      },
    });
  }

  async #releaseOwner(
    orgId: string,
    slot: number,
    owner: string,
  ): Promise<'released' | 'lost' | 'unavailable'> {
    try {
      return Number(
        await this.#client.call(
          'DELIFEQ',
          `${this.#prefix}:${orgId}:${slot}`,
          owner,
        ),
      ) === 1
        ? 'released'
        : 'lost';
    } catch {
      return 'unavailable';
    }
  }
}

export const STEP_PERMIT_RENEWAL_DIVISOR = 3;
