import type {
  ModelInput,
  ModelMessage,
} from '../../infrastructure/ai/index.js';
import type { RunProfile } from './run-contracts.js';
import { estimateInputTokens } from '../usage/index.js';

export type ModelContext =
  | readonly ModelMessage[]
  | {
      readonly beforePrompt: readonly ModelMessage[];
      readonly afterPrompt: readonly ModelMessage[];
    };

interface ContextParts {
  readonly beforePrompt: readonly ModelMessage[];
  readonly afterPrompt: readonly ModelMessage[];
}

function contextParts(context: ModelContext): ContextParts {
  return Array.isArray(context)
    ? { beforePrompt: context as readonly ModelMessage[], afterPrompt: [] }
    : (context as ContextParts);
}

export function assembleModelInput(
  profile: RunProfile,
  context: ModelContext,
  prompt: string,
  effort = profile.reasoning?.default,
  signal = new AbortController().signal,
  schemas?: ModelInput['schemas'],
): ModelInput {
  const resolved = profile.reasoning;
  if (resolved && (!effort || !resolved.allowed.includes(effort)))
    throw new Error('AI reasoning effort is not allowed');
  if (!resolved && effort !== undefined)
    throw new Error('AI reasoning effort is not allowed');
  const maxOutputTokens = resolved
    ? (resolved.outputLimits[effort!] ?? 0)
    : profile.maxOutputTokens;
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1)
    throw new Error('AI reasoning output limit is invalid');
  const { beforePrompt, afterPrompt } = contextParts(context);
  const messages: ModelMessage[] = [
    ...(profile.instructions
      ? [{ role: 'system' as const, content: profile.instructions.text }]
      : []),
    ...beforePrompt,
    { role: 'user', content: prompt },
    ...afterPrompt,
  ];
  const input: ModelInput = {
    model: profile.defaultModel,
    provider: '',
    messages,
    maxOutputTokens,
    signal,
    ...(effort ? { effort } : {}),
    ...(schemas ? { schemas } : {}),
  };
  if (profile.maxEstimatedInputTokens !== undefined) {
    const instructionBytes = Buffer.byteLength(
      JSON.stringify(profile.instructions?.text ?? ''),
      'utf8',
    );
    if (instructionBytes > 8_192)
      throw new Error('AI trusted instructions exceed configured maximum');
    if (
      estimateInputTokens(input).inputTokens > profile.maxEstimatedInputTokens
    )
      throw new Error('AI input exceeds configured maximum');
  }
  return input;
}

export function fitModelContext(
  profile: RunProfile,
  context: ModelContext,
  prompt: string,
  effort = profile.reasoning?.default,
  signal = new AbortController().signal,
  schemas?: ModelInput['schemas'],
): { readonly input: ModelInput; readonly context: ModelContext } {
  const flatContext = Array.isArray(context);
  let parts: ContextParts = contextParts(context);
  while (true) {
    const input = assembleModelInput(
      { ...profile, maxEstimatedInputTokens: Number.MAX_SAFE_INTEGER },
      parts,
      prompt,
      effort,
      signal,
      schemas,
    );
    const estimated = estimateInputTokens(input).inputTokens;
    if (
      profile.maxEstimatedInputTokens === undefined ||
      estimated <= profile.maxEstimatedInputTokens
    )
      return {
        input,
        context: flatContext ? parts.beforePrompt : parts,
      };
    if (!parts.beforePrompt.length && !parts.afterPrompt.length)
      throw new Error('AI input exceeds configured maximum');
    parts = parts.beforePrompt.length
      ? {
          beforePrompt: parts.beforePrompt.slice(1),
          afterPrompt: parts.afterPrompt,
        }
      : {
          beforePrompt: [],
          afterPrompt: parts.afterPrompt.slice(1),
        };
  }
}
