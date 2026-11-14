import type { RunErrorCode } from '@lexon/contracts';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type ModelMessagePart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool-call';
      readonly toolCallId: string;
      readonly toolName: string;
      readonly input: JsonValue;
    };

export interface ModelToolResultPart {
  readonly type: 'tool-result';
  readonly toolCallId: string;
  readonly toolName: string;
  readonly result: JsonValue;
}

export type ModelMessage =
  | { readonly role: 'system' | 'user'; readonly content: string | JsonValue }
  | {
      readonly role: 'assistant';
      readonly content: string | readonly ModelMessagePart[];
    }
  | { readonly role: 'tool'; readonly content: readonly ModelToolResultPart[] };

export interface ModelInput {
  readonly runId?: string;
  readonly stepId?: string;
  readonly attemptId?: string;
  readonly model: string;
  readonly provider: string;
  readonly effort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  readonly messages: readonly ModelMessage[];
  readonly schemas?: Readonly<Record<string, JsonValue>>;
  readonly maxOutputTokens: number;
  readonly signal: AbortSignal;
}

export interface ReportedUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly reasoningOutputTokens?: number;
}

export type ModelAttemptOutcome = 'succeeded' | 'failed' | 'unknown';

export type DecimalUsdString = `${number}`;

export type ModelEvent =
  | {
      readonly type: 'metadata';
      readonly generationId?: string;
      readonly provider?: string;
    }
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'reasoning-start'; readonly attemptId: string }
  | {
      readonly type: 'reasoning-summary-delta';
      readonly attemptId: string;
      readonly text: string;
    }
  | {
      readonly type: 'reasoning-end';
      readonly attemptId: string;
      readonly durationMs: number | null;
    }
  | {
      readonly type: 'tool-proposal';
      readonly toolCallId: string;
      readonly toolName: string;
      readonly input: JsonValue;
    }
  | {
      readonly type: 'usage';
      readonly usage: Partial<ReportedUsage>;
      readonly costUsd?: DecimalUsdString;
    }
  | { readonly type: 'outcome'; readonly outcome: ModelOutcome };

export interface ModelOutcome {
  readonly finishReason:
    'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error';
  readonly attemptOutcome: ModelAttemptOutcome;
  /** Explicit retry permission for later lifecycle policy; never inferred from safeCode. */
  readonly retryable: boolean;
  readonly generationId?: string;
  readonly provider?: string;
  readonly usage?: Partial<ReportedUsage>;
  readonly costUsd?: DecimalUsdString;
  readonly safeCode?: RunErrorCode;
}

export interface ModelGateway {
  generate(input: ModelInput): AsyncIterable<ModelEvent>;
}
