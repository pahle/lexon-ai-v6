import type { RunActor } from '../identity-access/index.js';
import type { TenantSession } from '../../infrastructure/db/index.js';

export const DEFAULT_MAX_ATTEMPTS_PER_STEP = 2;
/** Hard cap on opaque run resource references; references grant no authority. */
export const MAX_RUN_RESOURCE_REFERENCES = 32;
export const DEFAULT_MAX_TOOL_PROPOSALS_PER_GENERATION = 8;
export const MAX_TOOL_PROPOSALS_PER_GENERATION = 15;

export const RUN_REGISTRATION_LIMITS = Object.freeze({
  maxInputBytes: 16_384,
  maxResultBytes: 16_384,
  maxTimeoutMs: 5_000,
});

export interface RunProfile {
  readonly id: string;
  readonly version: number;
  readonly allowedModels: readonly string[];
  readonly defaultModel: string;
  readonly queue: 'ai-interactive' | 'ai-batch';
  readonly priority: number;
  readonly maxIterations: number;
  readonly tokenBudget: number;
  readonly maxOutputTokens: number;
  readonly instructions?: Readonly<{
    readonly id: string;
    readonly version: string;
    readonly text: string;
  }>;
  readonly reasoning?: Readonly<{
    readonly allowed: readonly (
      'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    )[];
    readonly default: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    readonly outputLimits: Readonly<Record<string, number>>;
    readonly runBudgets: Readonly<Record<string, number>>;
  }>;
  readonly maxEstimatedInputTokens?: number;
  readonly maxAttemptsPerStep?: number;
  readonly maxToolProposalsPerGeneration?: number;
  readonly contextBudgets: Readonly<Record<string, number>>;
  readonly capabilities: readonly string[];
  readonly childBounds?: Readonly<{ maxDepth: number; tokenBudget: number }>;
  readonly maxToolInputBytes?: number;
  readonly maxToolResultBytes?: number;
  readonly maxToolTimeoutMs?: number;
}

export interface ContextPiece {
  readonly label: string;
  readonly text: string;
}

export interface ContextProvider {
  readonly id: string;
  readonly version: number;
  collect(args: {
    readonly actor: RunActor;
    readonly runId: string;
    readonly input: Readonly<Record<string, unknown>>;
    readonly budget: number;
  }): Promise<ContextPiece[]>;
}

export interface ToolExecutionContext {
  readonly actor: RunActor;
  readonly runId: string;
  readonly operationId: string;
  readonly signal: AbortSignal;
}

interface ToolBase {
  readonly id: string;
  readonly version: number;
  readonly inputSchema: import('zod').ZodType;
  /**
   * Whether a proposal for this tool pauses the run awaiting an owner
   * decision, and which kind of pause it is (`requiresApproval` ≡
   * `pauseKind !== null`). Persisted operations take `kind` from it.
   */
  readonly pauseKind: 'approval' | 'question' | null;
  readonly timeoutMs: number;
  readonly maxInputBytes?: number;
  readonly maxResultBytes: number;
  readonly capabilities: readonly string[];
  /**
   * Maximum accepted proposals for this tool per run, counted by tool name
   * across every step and including same-generation proposals.
   */
  readonly maxPerRun?: number;
}

export interface ReadToolDefinition extends ToolBase {
  readonly kind: 'read';
  execute(input: unknown, context: ToolExecutionContext): Promise<unknown>;
}

export interface TransactionalWriteToolDefinition extends ToolBase {
  readonly kind: 'write';
  readonly idempotency: { readonly mode: 'transactional' };
  execute(
    input: unknown,
    context: ToolExecutionContext & { readonly tenant: TenantSession },
  ): Promise<unknown>;
}

export interface IdempotencyKeyWriteToolDefinition extends ToolBase {
  readonly kind: 'write';
  readonly idempotency: { readonly mode: 'idempotency-key' };
  executeExternal(
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<unknown>;
}

export interface ReconcileWriteToolDefinition extends ToolBase {
  readonly kind: 'write';
  readonly idempotency: { readonly mode: 'reconcile' };
  executeExternal(
    input: unknown,
    context: ToolExecutionContext,
  ): Promise<unknown>;
  reconcile(
    operationId: string,
    context: ToolExecutionContext,
  ): Promise<'committed' | 'not_committed' | 'unknown'>;
}

/**
 * A pause-only tool: the model proposes it, the run pauses awaiting the
 * owner, and the stored decision IS the result — it has no execute. The
 * single in-transaction decision is its once-semantics.
 */
export interface PauseToolDefinition extends ToolBase {
  readonly kind: 'pause';
  readonly interaction: 'approval' | 'question';
  readonly pauseKind: 'approval' | 'question';
  readonly idempotency: { readonly mode: 'transactional' };
}

export type ToolDefinition =
  | ReadToolDefinition
  | TransactionalWriteToolDefinition
  | IdempotencyKeyWriteToolDefinition
  | ReconcileWriteToolDefinition
  | PauseToolDefinition;

export interface EngineRegistrations {
  readonly profiles: readonly RunProfile[];
  readonly contexts: readonly ContextProvider[];
  readonly tools: readonly ToolDefinition[];
}
