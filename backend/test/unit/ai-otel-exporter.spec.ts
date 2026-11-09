import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { startAiTelemetry } from '../../src/infrastructure/telemetry/index.js';

it('serializes only safe span names, scope, route, and context to configured OTLP', async () => {
  const payloads: unknown[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      payloads.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing local collector address');
  const telemetry = await startAiTelemetry({
    collectorUrl: `http://127.0.0.1:${address.port}/v1/traces`,
    serviceName: 'lexon-test',
  });
  try {
    const tracer = trace.getTracer(
      'SCOPE_PRIVATE_SENTINEL',
      'HOSTILE_SCOPE_VERSION',
    );
    const parentContext = trace.setSpanContext(context.active(), {
      traceId: '44444444444444444444444444444444',
      spanId: '5555555555555555',
      traceFlags: 1,
      traceState: {
        serialize: () => 'TRACE_STATE_PRIVATE_SENTINEL',
      } as never,
    });
    const span = tracer.startSpan(
      'execute_tool TOOL_NAME_PRIVATE_SENTINEL',
      {},
      parentContext,
    );
    span.setAttribute('runId', '11111111-1111-4111-8111-111111111111');
    span.setAttribute('stepId', '22222222-2222-4222-8222-222222222222');
    span.setAttribute('operationId', '33333333-3333-4333-8333-333333333333');
    span.setAttribute('model', 'openai/gpt-6-luna');
    span.setAttribute('provider', 'azure/us');
    span.setAttribute('prompt', 'PROMPT_PRIVATE_SENTINEL');
    span.addEvent('exception', {
      'exception.message': 'ERROR_PRIVATE_SENTINEL',
    });
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: 'STATUS_PRIVATE_SENTINEL',
    });
    span.end();
    await telemetry.close();

    expect(payloads).toHaveLength(1);
    const serialized = JSON.stringify(payloads[0]);
    for (const sentinel of [
      'SCOPE_PRIVATE_SENTINEL',
      'HOSTILE_SCOPE_VERSION',
      'TOOL_NAME_PRIVATE_SENTINEL',
      'TRACE_STATE_PRIVATE_SENTINEL',
      'PROMPT_PRIVATE_SENTINEL',
      'ERROR_PRIVATE_SENTINEL',
      'STATUS_PRIVATE_SENTINEL',
    ])
      expect(serialized).not.toContain(sentinel);
    expect(serialized).toContain('ai.tool');
    expect(serialized).toContain('openai/gpt-6-luna');
    expect(serialized).toContain('azure/us');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
