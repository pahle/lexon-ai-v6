export type AiRunStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelling'
  | 'cancelled';

export interface RunRecord {
  readonly id: string;
  readonly orgId: string;
  readonly initiatingUserId: string;
  readonly initiatingSessionId: string | null;
  readonly initiatingMfaVerifiedAt: Date | null;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly resolvedConfig: unknown;
  readonly modelId: string;
  readonly inputText: string;
  readonly status: AiRunStatus;
  readonly runVersion: number;
  readonly nextSequence: number;
  readonly modelIterations: number;
  readonly inputBudgetTokens: number;
  readonly outputBudgetTokens: number;
  readonly partialOutput: string;
  readonly reasoningSummary: string | null;
  readonly reasoningDurationMs: number | null;
  /** Monotonic Valkey stream incarnation allocator, never copied from a snapshot. */
  readonly streamGeneration: number;
  readonly streamSnapshotGeneration: number;
  readonly streamEventId: string | null;
  readonly streamAttemptId: string | null;
  readonly streamRevision: number;
  readonly streamResumable: boolean;
  readonly finalOutput: string | null;
  readonly errorCode: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly completedAt: Date | null;
}

export interface RunInsert {
  readonly id: string;
  readonly orgId: string;
  readonly initiatingUserId: string;
  readonly initiatingSessionId?: string | null;
  readonly initiatingMfaVerifiedAt?: Date | null;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly resolvedConfig: unknown;
  readonly modelId: string;
  readonly inputText: string;
  readonly inputBudgetTokens: number;
  readonly outputBudgetTokens: number;
}

export type StepState =
  'pending' | 'claimed' | 'committed' | 'awaiting_approval' | 'failed';

export interface StepRecord {
  readonly id: string;
  readonly orgId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly expectedVersion: number;
  readonly state: StepState;
  readonly fence: number;
  readonly leaseUntil: Date | null;
  readonly committedText: string | null;
  readonly commitData: unknown | null;
  readonly updatedAt: Date;
}

export interface StepClaim {
  readonly runId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly stepId: string;
  readonly sequence: number;
  readonly expectedVersion: number;
  readonly fence: number;
  readonly leaseUntil: Date;
}

/** Tenant-scoped reference to the latest durable step of a terminal run. */
export interface TerminalStreamReference {
  readonly runId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly stepId: string;
  readonly sequence: number;
  readonly expectedVersion: number;
  readonly fence: number;
  /** True when no step has committed and this references the real current step. */
  readonly neutral?: boolean;
}

export interface CommittedStreamReference extends TerminalStreamReference {
  readonly committedRunVersion: number;
  readonly committedStatus:
    'running' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
}

export type AiOperationMode =
  'read' | 'transactional' | 'idempotency-key' | 'reconcile';
export type AiOperationStatus =
  | 'pending'
  | 'awaiting_approval'
  | 'approved'
  | 'rejected'
  | 'succeeded'
  | 'failed'
  | 'outcome_unknown';

export interface OperationProposal {
  readonly callOccurrence: number;
  readonly toolName: string;
  readonly toolVersion: number;
  readonly mode: AiOperationMode;
  readonly args: unknown;
  readonly argsHash: string;
  readonly snapshotHash: string;
  readonly approvalRequired: boolean;
}

export interface OperationRecord extends OperationProposal {
  readonly id: string;
  readonly orgId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly status: AiOperationStatus;
  readonly result: unknown | null;
  readonly errorCode: string | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
  readonly decision?: 'approve' | 'reject' | null;
  readonly decidedByUserId?: string | null;
  readonly decidedAt?: Date | null;
}

export interface StepCommit {
  readonly state: 'committed' | 'awaiting_approval';
  readonly text: string;
  readonly data: unknown;
}

export interface AttemptRecord {
  readonly attemptId: string;
  readonly orgId: string;
  readonly runId: string;
  readonly stepId: string;
  readonly ordinal: number;
  readonly modelId: string;
  readonly estimatorVersion: string;
  readonly estimatedInputTokens: number;
  readonly reservedInputTokens: number;
  readonly reservedOutputTokens: number;
  readonly generationId: string | null;
  readonly provider: string | null;
  readonly reportedInputTokens: number | null;
  readonly reportedOutputTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly reasoningOutputTokens: number | null;
  readonly costUsd: string | null;
  readonly active: boolean;
  readonly outcome: 'succeeded' | 'failed' | 'unknown' | null;
  readonly createdAt: Date;
  readonly settledAt: Date | null;
}

export interface AttemptInsert {
  readonly attemptId: string;
  readonly ordinal: number;
  readonly modelId: string;
  readonly estimatorVersion: string;
  readonly estimatedInputTokens: number;
  readonly reservedInputTokens: number;
  readonly reservedOutputTokens: number;
}

export interface ReportedUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly reasoningOutputTokens?: number;
}
