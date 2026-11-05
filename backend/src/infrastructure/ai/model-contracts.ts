import type { RunErrorCode } from '@lexon/contracts';

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface ModelInput {
  readonly model: string;
  readonly provider: string;
  readonly messages: readonly {
    readonly role: 'system' | 'user' | 'assistant' | 'tool';
    readonly content: string | JsonValue;
  }[];
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

export type DecimalUsdString = `${number}`;

export type ModelEvent =
  | { readonly type: 'metadata'; readonly generationId?: string; readonly provider?: string }
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'tool-proposal';
      readonly toolCallId: string;
      readonly toolName: string;
      readonly input: JsonValue;
    }
  | { readonly type: 'usage'; readonly usage: Partial<ReportedUsage>; readonly costUsd?: DecimalUsdString };

export interface ModelOutcome {
  readonly finishReason: 'stop' | 'tool_calls' | 'error';
  readonly generationId?: string;
  readonly provider?: string;
  readonly usage?: Partial<ReportedUsage>;
  readonly costUsd?: DecimalUsdString;
  readonly safeCode?: RunErrorCode;
}

export interface ModelGateway {
  generate(input: ModelInput): AsyncIterable<ModelEvent>;
}
