import type { JobEnvelope, TenantJobHandler } from '../db/index.js';
import type { StepPermit } from './step-permits.js';

export type DurableJobResult =
  Readonly<{ kind: 'done' }> | Readonly<{ kind: 'busy'; retryAtMs: number }>;

export interface DurableJobContext {
  readonly signal: AbortSignal;
  readonly permit: StepPermit;
}

export type DurableJobHandler = (
  job: JobEnvelope,
  context: DurableJobContext,
) => Promise<DurableJobResult>;

export type QueueJobHandler =
  | Readonly<{
      strategy: 'short-transaction';
      handle: TenantJobHandler;
    }>
  | Readonly<{
      strategy: 'durable-step';
      handle: DurableJobHandler;
    }>;

export interface JobHandlerRegistry {
  resolve(type: string): QueueJobHandler;
}
