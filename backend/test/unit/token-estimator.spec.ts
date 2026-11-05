import { expect, test } from 'vitest';
import type {
  JsonValue,
  ModelInput,
  ModelToolResultPart,
} from '../../src/infrastructure/ai/index.js';
import { estimateInputTokens } from '../../src/modules/usage/token-estimator.js';

const signal = new AbortController().signal;

function input(
  messages: ModelInput['messages'],
  schemas?: ModelInput['schemas'],
): ModelInput {
  return {
    model: 'synthetic/model',
    provider: 'synthetic',
    messages,
    ...(schemas ? { schemas } : {}),
    maxOutputTokens: 512,
    signal,
  };
}

test('empty model-visible serialization includes framing allowance', () => {
  const modelInput = input([]);
  const serialization = JSON.stringify({ messages: [], schemas: {} });

  expect(estimateInputTokens(modelInput)).toEqual({
    version: 1,
    inputTokens: Buffer.byteLength(serialization, 'utf8') + 1024,
  });
});

test('estimates UTF-8 messages, context, tool results, and schemas with overhead', () => {
  const messages: ModelInput['messages'] = [
    { role: 'system', content: 'Analyze hukum Indonesia 🇮🇩' },
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'sdk-call',
          toolName: 'lookup',
          input: { query: 'putusan' },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'sdk-call',
          toolName: 'lookup',
          result: { result: 'putusan selesai', citations: ['Pasal 1'] },
        },
      ],
    },
  ];
  const schemas: NonNullable<ModelInput['schemas']> = {
    searchCase: {
      description: 'Cari putusan',
      input: { type: 'object', properties: { id: { type: 'string' } } },
    },
  };
  const serialization = JSON.stringify({
    messages,
    schemas: {
      searchCase: {
        description: 'Cari putusan',
        input: {
          properties: { id: { type: 'string' } },
          type: 'object',
        },
      },
    },
  });

  expect(estimateInputTokens(input(messages, schemas))).toEqual({
    version: 1,
    inputTokens: Buffer.byteLength(serialization, 'utf8') + 3 * 64 + 256 + 1024,
  });
});

test('excludes provider metadata and abort signal from the estimate', () => {
  const messages: ModelInput['messages'] = [
    { role: 'user', content: 'Bantu telaah kontrak.' },
  ];
  const first = input(messages);
  const second: ModelInput = {
    ...first,
    model: 'another/model',
    provider: 'another-provider',
    signal: new AbortController().signal,
  };

  expect(estimateInputTokens(first)).toEqual(estimateInputTokens(second));
});

test('rejects non-finite visible numbers and unsafe token arithmetic', () => {
  const invalid = input([
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'sdk-call',
          toolName: 'lookup',
          result: { count: Number.NaN } as unknown as JsonValue,
        } satisfies ModelToolResultPart,
      ],
    },
  ]);

  expect(() => estimateInputTokens(invalid)).toThrow();
});

test('preserves own __proto__ JSON keys in tool results and tool schemas', () => {
  const large = 'x'.repeat(10_000);
  const toolResult = JSON.parse(
    `{"__proto__":{"payload":"${large}"}}`,
  ) as JsonValue;
  const schemas = JSON.parse(
    `{"lookup":{"properties":{"__proto__":{"type":"string","description":"${large}"}}}}`,
  ) as ModelInput['schemas'];
  const messages: ModelInput['messages'] = [
    {
      role: 'assistant',
      content: [
        {
          type: 'tool-call',
          toolCallId: 'sdk-call',
          toolName: 'lookup',
          input: { large },
        },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'sdk-call',
          toolName: 'lookup',
          result: toolResult,
        },
      ],
    },
  ];
  const serialization = JSON.stringify({ messages, schemas });

  expect(estimateInputTokens(input(messages, schemas))).toEqual({
    version: 1,
    inputTokens: Buffer.byteLength(serialization, 'utf8') + 2 * 64 + 256 + 1024,
  });
});
