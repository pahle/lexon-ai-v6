export interface EvaluationServices {
  readonly postgresUrl: string;
  readonly valkeyUrl: string;
  readonly seaweedS3Url: string;
}

export interface EvaluationScoreReport {
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
  read(actor: EvaluationActor, runId: string): Promise<EvaluationScoreReport>;
  drain(): Promise<void>;
  close(): Promise<void>;
}

export interface EvaluationOptions {
  readonly services: EvaluationServices;
  readonly fixtureSet: 'deterministic';
}

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
  drain(): Promise<void>;
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
