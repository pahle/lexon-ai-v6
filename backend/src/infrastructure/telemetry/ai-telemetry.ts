import {
  context,
  SpanStatusCode,
  trace,
  type Span,
  type TextMapPropagator,
  type Tracer,
} from '@opentelemetry/api';

const safeNames = new Set(['ai.run', 'ai.step', 'ai.model', 'ai.tool']);
const allowedAttributes = new Set([
  'runId',
  'stepId',
  'operationId',
  'attemptId',
  'model',
  'provider',
  'status',
  'safeCode',
]);
const attributeAliases: Readonly<Record<string, string>> = {
  'ai.settings.context.runId': 'runId',
  'ai.settings.context.stepId': 'stepId',
  'ai.settings.context.attemptId': 'attemptId',
  'gen_ai.request.model': 'model',
  'gen_ai.provider.name': 'provider',
};
const identifier = /^[a-zA-Z0-9._:-]{1,128}$/;
const statuses = new Set(['started', 'succeeded', 'failed', 'cancelled']);
const safeCodes = new Set([
  'AI_INTERNAL',
  'AI_PROVIDER_UNAVAILABLE',
  'AI_PROVIDER_REJECTED',
]);

export interface SafeAiSpan {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: 'ok' | 'error'): void;
  end(): void;
}

export interface SafeAiTracer {
  startSpan(
    name: 'ai.run' | 'ai.step' | 'ai.model' | 'ai.tool',
    attributes: Readonly<Record<string, unknown>>,
  ): SafeAiSpan;
  withSpan<T>(
    name: 'ai.run' | 'ai.step' | 'ai.model' | 'ai.tool',
    attributes: Readonly<Record<string, unknown>>,
    work: (span: SafeAiSpan) => Promise<T>,
  ): Promise<T>;
}

export function createSafeAiTracer(tracer: Tracer): SafeAiTracer {
  return {
    startSpan(name, attributes) {
      if (!safeNames.has(name)) throw new Error('Invalid AI span name');
      const span = tracer.startSpan(name);
      const safeSpan = safeSpanPort(span);
      for (const [key, value] of Object.entries(attributes))
        safeSpan.setAttribute(key, value as string | number | boolean);
      return safeSpan;
    },
    async withSpan(name, attributes, work) {
      if (!safeNames.has(name)) throw new Error('Invalid AI span name');
      return tracer.startActiveSpan(name, async (span) => {
        const safeSpan = safeSpanPort(span);
        for (const [key, value] of Object.entries(attributes))
          safeSpan.setAttribute(key, value as string | number | boolean);
        try {
          const result = await work(safeSpan);
          safeSpan.setStatus('ok');
          return result;
        } catch (error) {
          safeSpan.setStatus('error');
          throw error;
        } finally {
          safeSpan.end();
        }
      });
    },
  };
}

export function getSafeAiTracer(): SafeAiTracer {
  return createSafeAiTracer(trace.getTracer('lexon.ai'));
}

function safeSpanPort(span: Span): SafeAiSpan {
  return {
    setAttribute(key, value) {
      if (!allowedAttributes.has(key)) return;
      if (key === 'status') {
        if (typeof value === 'string' && statuses.has(value))
          span.setAttribute(key, value);
        return;
      }
      if (key === 'safeCode') {
        if (typeof value === 'string' && safeCodes.has(value))
          span.setAttribute(key, value);
        return;
      }
      if (typeof value !== 'string' || identifier.test(value))
        span.setAttribute(key, value);
    },
    setStatus(status) {
      span.setStatus({
        code: status === 'ok' ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      });
    },
    end() {
      span.end();
    },
  };
}

export async function startAiTelemetry(options: {
  readonly collectorUrl?: string;
  readonly serviceName: string;
}): Promise<{ close(): Promise<void> }> {
  if (!options.collectorUrl) return { close: async () => undefined };
  const collector = new URL(options.collectorUrl);
  if (!['http:', 'https:'].includes(collector.protocol))
    throw new Error('Invalid telemetry collector URL');

  const [{ NodeSDK }, { OTLPTraceExporter }] = await Promise.all([
    import('@opentelemetry/sdk-node'),
    import('@opentelemetry/exporter-trace-otlp-http'),
  ]);
  const exporter = new SafeSpanExporter(
    new OTLPTraceExporter({ url: collector.toString() }),
    options.serviceName,
  );
  const sdk = new NodeSDK({
    autoDetectResources: false,
    serviceName: options.serviceName,
    traceExporter: exporter,
    logRecordProcessors: [],
    metricReaders: [],
    instrumentations: [],
    textMapPropagator: noPropagation,
  });
  sdk.start();
  return { close: () => sdk.shutdown() };
}

const noPropagation: TextMapPropagator = {
  inject() {},
  extract: () => context.active(),
  fields: () => [],
};

class SafeSpanExporter {
  constructor(
    private readonly exporter: import('@opentelemetry/sdk-trace-base').SpanExporter,
    private readonly serviceName: string,
  ) {}

  export(
    spans: import('@opentelemetry/sdk-trace-base').ReadableSpan[],
    callback: Parameters<
      import('@opentelemetry/sdk-trace-base').SpanExporter['export']
    >[1],
  ): void {
    this.exporter.export(sanitizeAiSpans(spans, this.serviceName), callback);
  }

  shutdown(): Promise<void> {
    return this.exporter.shutdown();
  }
}

export function sanitizeAiSpans(
  spans: readonly import('@opentelemetry/sdk-trace-base').ReadableSpan[],
  serviceName: string,
): import('@opentelemetry/sdk-trace-base').ReadableSpan[] {
  return spans.map((span) => sanitizeSpan(span, serviceName));
}

function sanitizeSpan(
  span: import('@opentelemetry/sdk-trace-base').ReadableSpan,
  serviceName: string,
): import('@opentelemetry/sdk-trace-base').ReadableSpan {
  const attributes: Record<string, string | number | boolean> = {};
  for (const [sourceKey, value] of Object.entries(span.attributes)) {
    const key = attributeAliases[sourceKey] ?? sourceKey;
    if (!allowedAttributes.has(key)) continue;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      if (key === 'status' && !statuses.has(String(value))) continue;
      if (key === 'safeCode' && !safeCodes.has(String(value))) continue;
      if (typeof value === 'string' && !identifier.test(value)) continue;
      attributes[key] = value;
    }
  }
  return {
    ...span,
    attributes,
    events: [],
    links: [],
    status: { code: span.status.code, message: '' },
    resource: {
      ...span.resource,
      attributes: { 'service.name': serviceName },
    },
  };
}
