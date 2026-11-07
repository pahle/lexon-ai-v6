import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { trace } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  registerTelemetry,
  streamText,
  simulateReadableStream,
  stepCountIs,
  tool,
} from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { OpenTelemetry } from '@ai-sdk/otel';
import { z } from 'zod';
import {
  createSafeAiTracer,
  sanitizeAiSpans,
  startAiTelemetry,
} from '../../src/infrastructure/telemetry/index.js';

describe('AI telemetry privacy', () => {
  it('sets OTel status consistently with safe succeeded, failed, and continued outcomes', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const tracer = createSafeAiTracer(provider.getTracer('status-test'));

    for (const status of ['succeeded', 'failed', 'continued'] as const) {
      const span = tracer.startSpan('ai.run', { status });
      span.end();
    }
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    expect(spans.map((span) => span.attributes.status)).toEqual([
      'succeeded',
      'failed',
      'continued',
    ]);
    expect(spans.map((span) => span.status.code)).toEqual([1, 2, 0]);
    await provider.shutdown();
  });

  it('records only allowlisted run metadata from real spans', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    const tracer = createSafeAiTracer(provider.getTracer('test'));
    const promptSentinel = 'HOSTILE_PROMPT_SENTINEL';
    const secretSentinel = 'OPENROUTER_KEY_SENTINEL';

    await tracer.withSpan(
      'ai.run',
      {
        runId: '11111111-1111-4111-8111-111111111111',
        model: 'gpt-6-luna',
        status: 'failed',
        prompt: promptSentinel,
        apiKey: secretSentinel,
      },
      async (span) => {
        span.setAttribute('error.message', promptSentinel);
      },
    );
    await provider.forceFlush();

    const serializedTelemetry = JSON.stringify(
      exporter
        .getFinishedSpans()
        .map(({ name, attributes, status, events, links }) => ({
          name,
          attributes,
          status,
          events,
          links,
        })),
    );
    expect(serializedTelemetry).toContain('ai.run');
    expect(serializedTelemetry).toContain(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(serializedTelemetry).toContain('gpt-6-luna');
    expect(serializedTelemetry).toContain('failed');
    expect(serializedTelemetry).not.toContain(promptSentinel);
    expect(serializedTelemetry).not.toContain(secretSentinel);
    await provider.shutdown();
  });

  it('does not initialize a provider or send requests without a collector URL', async () => {
    const names = [
      'OTEL_TRACES_EXPORTER',
      'OTEL_METRICS_EXPORTER',
      'OTEL_LOGS_EXPORTER',
      'OTEL_EXPORTER_OTLP_ENDPOINT',
    ] as const;
    const previous = new Map(names.map((name) => [name, process.env[name]]));
    process.env.OTEL_TRACES_EXPORTER = 'otlp';
    process.env.OTEL_METRICS_EXPORTER = 'otlp';
    process.env.OTEL_LOGS_EXPORTER = 'otlp';
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing test collector address');
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${address.port}/v1/traces`;
    try {
      const telemetry = await startAiTelemetry({ serviceName: 'lexon-test' });
      const span = trace.getTracer('lexon-test').startSpan('probe');
      expect(span.isRecording()).toBe(false);
      span.end();
      await telemetry.close();
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(requests).toBe(0);
    } finally {
      for (const name of names) {
        const value = previous.get(name);
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('emits AI SDK spans without recording prompt or generated text', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
    registerTelemetry(
      new OpenTelemetry({
        providerMetadata: false,
        usage: false,
        embedding: false,
        reranking: false,
        runtimeContext: true,
        headers: false,
        toolChoice: false,
        schema: false,
      }),
    );
    const promptSentinel = 'ACTUAL_AI_HOSTILE_PROMPT_SENTINEL';
    const outputSentinel = 'ACTUAL_AI_PROVIDER_OUTPUT_SENTINEL';
    const runId = '77777777-7777-4777-8777-777777777777';
    const stepId = '88888888-8888-4888-8888-888888888888';
    const attemptId = '99999999-9999-4999-8999-999999999999';
    let callCount = 0;
    const result = streamText({
      model: new MockLanguageModelV4({
        provider: 'openrouter',
        modelId: 'openai/gpt-6-luna',
        doStream: async () => {
          callCount++;
          return {
            stream: simulateReadableStream({
              chunks: (callCount === 1
                ? [
                    {
                      type: 'tool-call',
                      toolCallId: 'private-tool-call-id',
                      toolName: 'private-tool',
                      input: JSON.stringify({ payload: promptSentinel }),
                    },
                    {
                      type: 'finish',
                      finishReason: { unified: 'tool-calls', raw: undefined },
                      usage: {
                        inputTokens: {
                          total: 2,
                          noCache: 2,
                          cacheRead: undefined,
                          cacheWrite: undefined,
                        },
                        outputTokens: {
                          total: 1,
                          text: 1,
                          reasoning: undefined,
                        },
                      },
                    },
                  ]
                : [
                    { type: 'text-start', id: 'text-1' },
                    { type: 'text-delta', id: 'text-1', delta: outputSentinel },
                    { type: 'text-end', id: 'text-1' },
                    {
                      type: 'finish',
                      finishReason: { unified: 'stop', raw: undefined },
                      usage: {
                        inputTokens: {
                          total: 2,
                          noCache: 2,
                          cacheRead: undefined,
                          cacheWrite: undefined,
                        },
                        outputTokens: {
                          total: 3,
                          text: 3,
                          reasoning: undefined,
                        },
                      },
                    },
                  ]) as never,
            }),
          };
        },
      }),
      prompt: promptSentinel,
      tools: {
        'private-tool': tool({
          inputSchema: z.strictObject({ payload: z.string() }),
          execute: async ({ payload }) => {
            expect(payload).toBe(promptSentinel);
            return outputSentinel;
          },
        }),
      },
      stopWhen: stepCountIs(2),
      runtimeContext: { runId, stepId, attemptId },
      telemetry: {
        isEnabled: true,
        recordInputs: false,
        recordOutputs: false,
        includeRuntimeContext: {
          runId: true,
          stepId: true,
          attemptId: true,
        },
      },
    });
    for await (const _part of result.fullStream) void _part;
    await createSafeAiTracer(provider.getTracer('lexon.ai.test')).withSpan(
      'ai.tool',
      {
        runId,
        stepId,
        operationId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        model: 'openai/gpt-6-luna',
        provider: 'openrouter',
        status: 'started',
      },
      async (span) => span.setAttribute('status', 'succeeded'),
    );
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const serializedTelemetry = JSON.stringify(
      spans.map(({ name, attributes, status, events, links, duration }) => ({
        name,
        attributes,
        status,
        events,
        links,
        duration,
      })),
    );
    expect(spans.length).toBeGreaterThan(0);
    expect(spans.every((span) => span.duration[0] >= 0)).toBe(true);
    expect(spans.some((span) => span.name.includes('invoke_agent'))).toBe(true);
    expect(
      spans.some((span) => span.name.includes('execute_tool private-tool')),
    ).toBe(true);
    expect(spans.some((span) => span.name.includes('openai/gpt-6-luna'))).toBe(
      true,
    );
    expect(spans.some((span) => span.name === 'ai.tool')).toBe(true);
    expect(serializedTelemetry).toContain(runId);
    expect(serializedTelemetry).toContain(stepId);
    expect(serializedTelemetry).toContain(attemptId);
    expect(serializedTelemetry).toContain('openai/gpt-6-luna');
    expect(serializedTelemetry).toContain('openrouter');
    expect(serializedTelemetry).not.toContain(promptSentinel);
    expect(serializedTelemetry).not.toContain(outputSentinel);
    expect(serializedTelemetry).toContain('private-tool-call-id');
    const safeTelemetry = JSON.stringify(
      sanitizeAiSpans(spans, 'lexon-test').map((span) => ({
        name: span.name,
        attributes: span.attributes,
        events: span.events,
        links: span.links,
        resource: span.resource.attributes,
      })),
    );
    expect(safeTelemetry).not.toContain(promptSentinel);
    expect(safeTelemetry).not.toContain(outputSentinel);
    expect(safeTelemetry).not.toContain('private-tool-call-id');
    const providerFailureSentinel = 'ACTUAL_PROVIDER_EXCEPTION_SENTINEL';
    const failure = streamText({
      model: new MockLanguageModelV4({
        provider: 'openrouter',
        modelId: 'openai/gpt-6-luna',
        doStream: async () => {
          throw new Error(providerFailureSentinel);
        },
      }),
      prompt: promptSentinel,
      telemetry: {
        isEnabled: true,
        recordInputs: false,
        recordOutputs: false,
        includeRuntimeContext: {
          runId: true,
          stepId: true,
          attemptId: true,
        },
      },
    });
    const failureParts: unknown[] = [];
    for await (const part of failure.fullStream) failureParts.push(part);
    expect(failureParts).toContainEqual(
      expect.objectContaining({ type: 'error' }),
    );
    await provider.forceFlush();
    const failureSpans = exporter.getFinishedSpans();
    expect(failureSpans.some((span) => span.status.code === 2)).toBe(true);
    const safeFailureTelemetry = JSON.stringify(
      sanitizeAiSpans(failureSpans, 'lexon-test').map(
        ({ attributes, events }) => ({
          attributes,
          events,
        }),
      ),
    );
    expect(
      JSON.stringify(
        failureSpans.map(({ attributes, events }) => ({ attributes, events })),
      ),
    ).toContain(providerFailureSentinel);
    expect(safeFailureTelemetry).not.toContain(providerFailureSentinel);
    await provider.shutdown();
  });
});
