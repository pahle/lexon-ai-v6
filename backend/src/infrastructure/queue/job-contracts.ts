import type { JobEnvelope, TenantJobHandler, StepClaim } from '../db/index.js';
import type { StepPermit } from './step-permits.js';

export type DurableJobResult =
  Readonly<{ kind: 'done' }> | Readonly<{ kind: 'busy'; retryAtMs: number }>;

export interface DurableJobContext {
  readonly signal: AbortSignal;
  readonly permit: StepPermit;
  readonly recordClaim?: (claim: StepClaim) => Promise<void>;
}

export type DurableJobHandler = (
  job: JobEnvelope,
  context: DurableJobContext,
) => Promise<DurableJobResult>;

export type QueueJobHandler =
  | Readonly<{
      strategy: 'cleanup-work';
      handle: (job: JobEnvelope) => Promise<'pending' | 'complete'>;
    }>
  | Readonly<{
      strategy: 'short-transaction';
      handle: TenantJobHandler;
    }>
  | Readonly<{
      /**
       * §7 expiry sweep: BullMQ-scheduled `ai.operation-expiry.v1` jobs carry
       * only `{name, data:{}}` — no tenant envelope. The consumer routes by
       * job name and the sweep discovers candidates cross-tenant.
       */
      strategy: 'expiry-sweep';
      handle: () => Promise<void>;
    }>
  | Readonly<{
      strategy: 'durable-step';
      handle: DurableJobHandler;
      exhausted?: (job: JobEnvelope) => Promise<'done' | 'retry'>;
    }>;

export interface JobHandlerRegistry {
  resolve(type: string): QueueJobHandler;
}
