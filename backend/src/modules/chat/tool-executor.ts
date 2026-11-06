import type { JsonValue, ModelMessage } from '../../infrastructure/ai/index.js';
import {
  AiOperationRepository,
  AiRunRepository,
  AiStepRepository,
  RunActorFactsRepository,
  type OperationRecord,
  type StepClaim,
  type TenantSession,
} from '../../infrastructure/db/index.js';
import {
  canonicalJson,
  hashOperationArgs,
  jsonbTextBytes,
} from '../../infrastructure/db/index.js';
import type { RunAuthorizationService } from '../identity-access/index.js';
import type { RunProfile } from './run-contracts.js';
import type { RunRegistry } from './run-registry.js';
import { fenceUntrusted } from './untrusted-context.js';
import { canonicalOperationHash } from './canonical-operation.js';

export type ToolIdempotencyMode =
  'transactional' | 'idempotency-key' | 'reconcile';

export type ToolRecoveryDecision =
  | 'return-stored'
  | 'execute-transaction'
  | 'retry-same-key'
  | 'reconcile-first'
  | 'outcome_unknown';

export function chooseToolRecovery(input: {
  readonly mode: ToolIdempotencyMode;
  readonly receipt?: unknown;
  readonly remoteApplied?: true | false | 'unknown';
}): ToolRecoveryDecision {
  if (input.receipt !== undefined) return 'return-stored';
  switch (input.mode) {
    case 'transactional':
      return 'execute-transaction';
    case 'idempotency-key':
      return 'retry-same-key';
    case 'reconcile':
      if (input.remoteApplied === false) return 'execute-transaction';
      if (input.remoteApplied === 'unknown') return 'outcome_unknown';
      return 'reconcile-first';
  }
}

export interface ToolResult {
  readonly operationId: string;
  readonly status: OperationRecord['status'];
  readonly result: JsonValue | null;
  readonly errorCode: string | null;
}

export class ToolPolicyOutcome extends Error {
  constructor(readonly code: 'AI_ACCESS_REVOKED' | 'AI_INVALID_TOOL') {
    super(code);
    this.name = 'ToolPolicyOutcome';
  }
}

export class ToolApprovalRequiredOutcome extends Error {
  constructor() {
    super('AI_TOOL_APPROVAL_REQUIRED');
    this.name = 'ToolApprovalRequiredOutcome';
  }
}

export class ToolExecutor {
  constructor(
    private readonly operations: AiOperationRepository,
    private readonly runs: AiRunRepository,
    private readonly steps: AiStepRepository,
    private readonly facts: RunActorFactsRepository,
    private readonly authorization: RunAuthorizationService,
    private readonly registry: RunRegistry,
  ) {}

  async execute(
    tx: TenantSession,
    claim: StepClaim,
    operationId: string,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<ToolResult> {
    if (
      !(await this.steps.lockClaim(tx, claim)) ||
      !(await this.runs.markRunningForClaim(tx, {
        runId: claim.runId,
        stepId: claim.stepId,
        expectedVersion: claim.expectedVersion,
        sequence: claim.sequence,
        fence: claim.fence,
      }))
    )
      throw new Error('AI step claim lost');
    const operation = await this.operations.findForExecution(
      tx,
      claim,
      operationId,
    );
    if (!operation) throw new Error('AI operation unavailable');
    const run = await this.runs.find(tx, claim.runId);
    if (!run) throw new Error('AI run unavailable');
    const snapshot = asRecord(run.resolvedConfig);
    const profile = asRecord(snapshot.profileSnapshot) as unknown as RunProfile;
    const actorFacts = await this.facts.read(tx, {
      orgId: claim.orgId,
      userId: claim.userId,
      runId: run.id,
    });
    if (!actorFacts) throw new ToolPolicyOutcome('AI_ACCESS_REVOKED');
    const currentProfile = this.registry.profile(run.profileId);
    if (!currentProfile) throw new ToolPolicyOutcome('AI_ACCESS_REVOKED');
    const currentCapabilities = profile.capabilities.filter((capability) =>
      currentProfile.capabilities.includes(capability),
    );
    const decision = await this.authorization.authorize(
      tx,
      actorFacts,
      { profileId: run.profileId, capabilities: currentCapabilities },
      'resume',
    );
    if (!decision.allowed) throw new ToolPolicyOutcome('AI_ACCESS_REVOKED');

    if (operation.status === 'succeeded' || operation.status === 'failed')
      return toToolResult(operation);
    if (operation.status === 'awaiting_approval')
      return toToolResult(operation);
    if (operation.status === 'outcome_unknown') return toToolResult(operation);

    const tool = this.registry.tool(operation.toolName);
    if (
      !tool ||
      tool.version !== operation.toolVersion ||
      hashOperationArgs(operation.args) !== operation.argsHash ||
      canonicalOperationHash({
        toolId: tool.id,
        toolVersion: tool.version,
        args: operation.args,
      }) !== operation.snapshotHash ||
      (tool.kind === 'read' && operation.mode !== 'read') ||
      (tool.kind === 'write' &&
        (tool.idempotency.mode !== 'transactional' ||
          operation.mode !== 'transactional'))
    )
      throw new ToolPolicyOutcome('AI_INVALID_TOOL');
    if (
      tool.capabilities.some(
        (capability) => !decision.capabilities.includes(capability),
      )
    )
      throw new ToolPolicyOutcome('AI_ACCESS_REVOKED');
    if (tool.requiresApproval) throw new ToolApprovalRequiredOutcome();
    const actorScope = this.authorization.workerActorScope(tx, actorFacts);
    const rawResult = await actorScope.run((actor) => {
      const context = {
        actor,
        runId: run.id,
        operationId: operation.id,
        signal,
      };
      if (tool.kind === 'read') return tool.execute(operation.args, context);
      if (tool.idempotency.mode !== 'transactional' || !('execute' in tool))
        throw new Error('AI tool is not executable');
      return tool.execute(operation.args, { ...context, tenant: tx });
    });
    const result = boundToolResult(rawResult, tool.maxResultBytes);
    if (
      !(await this.operations.complete(tx, operation.id, {
        status: 'succeeded',
        result,
      }))
    )
      throw new Error('AI operation completion failed');
    return {
      operationId: operation.id,
      status: 'succeeded',
      result,
      errorCode: null,
    };
  }
}

export function boundToolResult(value: unknown, maxBytes: number): JsonValue {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Invalid AI tool result');
  if (Buffer.byteLength(encoded, 'utf8') <= maxBytes) {
    const parsed: unknown = JSON.parse(encoded);
    if (!isJsonValue(parsed)) throw new Error('Invalid AI tool result');
    if (jsonbTextBytes(parsed) <= maxBytes) return parsed;
  }
  const codePoints = [...encoded];
  const marker = '[TRUNCATED]';
  let low = 0;
  let high = codePoints.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = {
      _lexon_truncated: true,
      marker,
      preview: codePoints.slice(0, middle).join(''),
    };
    if (jsonbTextBytes(candidate) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  const truncated = {
    _lexon_truncated: true,
    marker,
    preview: codePoints.slice(0, low).join(''),
  };
  if (jsonbTextBytes(truncated) > maxBytes)
    throw new Error('AI tool result limit is too small');
  return truncated;
}

export function toolResultsAsMessages(
  operations: readonly OperationRecord[],
): ModelMessage[] {
  const completed = operations.filter(
    (operation) =>
      operation.status === 'succeeded' || operation.status === 'failed',
  );
  const messages: ModelMessage[] = [];
  for (const operation of completed) {
    const tool = JSON.parse(canonicalJson(operation.args)) as JsonValue;
    messages.push({
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: operation.id,
          toolName: operation.toolName,
          input: tool,
        },
      ],
    });
    messages.push({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: operation.id,
          toolName: operation.toolName,
          result: {
            untrusted: fenceUntrusted(
              canonicalJson(
                operation.result ?? {
                  errorCode: operation.errorCode ?? 'AI_INTERNAL',
                },
              ),
              `Tool result ${operation.id}`,
            ),
          },
        },
      ],
    });
  }
  return messages;
}

function toToolResult(operation: OperationRecord): ToolResult {
  return {
    operationId: operation.id,
    status: operation.status,
    result: isJsonValue(operation.result) ? operation.result : null,
    errorCode: operation.errorCode,
  };
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.values(value).every(isJsonValue)
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('AI run snapshot unavailable');
  return value as Record<string, unknown>;
}
