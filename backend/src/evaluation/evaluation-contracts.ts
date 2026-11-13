export interface EvaluationServices {
  readonly postgresUrl: string;
  readonly valkeyUrl: string;
  readonly seaweedS3Url: string;
}

export interface EvaluationScoreReport {
  readonly cases: ReadonlyArray<{
    readonly caseId: string;
    readonly score: number;
  }>;
  readonly scenarioId: string;
  readonly score: number;
  readonly status:
    'completed' | 'failed' | 'cancelled' | 'awaiting_approval' | 'unknown';
  readonly safeCode: string | null;
  readonly counts: Readonly<Record<string, number>>;
}

export interface EvaluationEngineReport {
  readonly scenarioId: string;
  readonly score: number;
  readonly status:
    'completed' | 'failed' | 'cancelled' | 'awaiting_approval' | 'unknown';
  readonly safeCode: string | null;
  readonly counts: Readonly<Record<string, number>>;
}

export interface EvaluationActor {
  readonly orgId: string;
  readonly userId: string;
}

export interface EvaluationEngine {
  readonly actors: readonly EvaluationActor[];
  start(
    actor: EvaluationActor,
    input: EvaluationStartInput,
  ): Promise<EvaluationRun>;
  cancel(actor: EvaluationActor, runId: string): Promise<void>;
  decide(
    actor: EvaluationActor,
    input: { runId: string; approved: boolean },
  ): Promise<void>;
  read(actor: EvaluationActor, runId: string): Promise<EvaluationEngineReport>;
  drain(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

export interface EvaluationOptions {
  readonly services: EvaluationServices;
  readonly fixtureSet: 'deterministic';
}

export interface EvaluationRealRequestPolicy {
  reserve(input: {
    readonly estimatedInputTokens: number;
    readonly maxOutputTokens: number;
  }): Promise<{ readonly id: string; readonly allowed: boolean }>;
  settle(input: {
    readonly id: string;
    readonly costUsd: string | null;
    readonly attemptOutcome: 'succeeded' | 'failed' | 'unknown';
  }): Promise<{ readonly budgetExceeded: boolean }>;
}

export interface RealEvaluationOptions {
  readonly services: EvaluationServices;
  readonly fixtureSet: 'real';
  readonly key: string;
  readonly attestation: string;
  readonly fetch?: typeof fetch;
  readonly priceCeiling: {
    readonly prompt: number;
    readonly completion: number;
  };
  readonly requestPolicy: EvaluationRealRequestPolicy;
}

export type EvaluationHarnessOptions =
  EvaluationOptions | RealEvaluationOptions;

export interface EvaluationStartInput {
  readonly scenarioId: string;
  readonly prompt: string;
}

export interface EvaluationRun {
  readonly runId: string;
}

export interface EvaluationContext {
  readonly version: string;
  readonly actors: readonly EvaluationActor[];
  start(
    actor: EvaluationActor,
    input: EvaluationStartInput,
  ): Promise<EvaluationRun>;
  cancel(actor: EvaluationActor, runId: string): Promise<void>;
  decide(
    actor: EvaluationActor,
    input: { runId: string; approved: boolean },
  ): Promise<void>;
  read(actor: EvaluationActor, runId: string): Promise<EvaluationScoreReport>;
  drain(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

export interface EvaluationInfrastructureLease {
  readonly descriptor: EvaluationServices;
  release(): Promise<void>;
}

export type EvaluationInfrastructureAcquire = () => Promise<{
  descriptor: EvaluationServices;
  release(): Promise<void>;
}>;
