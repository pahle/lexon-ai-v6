import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import { expect, it } from 'vitest';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { sanitizeAiSpans } from '../../src/infrastructure/telemetry/index.js';
import { createLoggingOptions } from '../../src/infrastructure/telemetry/logging.js';

function capture() {
  const lines: string[] = [];
  return {
    lines,
    sink: new Writable({
      write(chunk, _encoding, done) {
        lines.push(String(chunk));
        done();
      },
    }),
  };
}

it('excludes secrets and content from serialized background logs and errors', () => {
  const { lines, sink } = capture();
  const params = createLoggingOptions('dispatcher');
  const options = params.pinoHttp;
  if (!options || Array.isArray(options))
    throw new Error('expected pino options');
  const logger = pino(options, sink);
  const privateValue = 'PRIVATE_CONTENT_SENTINEL';
  logger.info(
    {
      event: 'job_processed',
      jobId: '6da2c40c-2b9a-4d92-b52a-111cc548b389',
      authorization: privateValue,
      cookie: privateValue,
      password: privateValue,
      token: privateValue,
      secret: privateValue,
      apiKey: privateValue,
      prompt: privateValue,
      message: privateValue,
      documentText: privateValue,
      nested: { payload: privateValue },
    },
    privateValue,
  );
  logger.error(new Error(privateValue), privateValue);
  logger.error(
    {
      err: {
        message: privateValue,
        stack: privateValue,
        cause: new Error(privateValue),
      },
      event: 'boot_failed',
      fields: ['DATABASE_APP_URL'],
      env: { DATABASE_APP_URL: privateValue },
    },
    privateValue,
  );
  const searchQueryCanary = 'PRIVATE_SEARCH_QUERY_CANARY';
  logger.error({
    event: 'http_request_failed',
    sentry: {
      request: {
        method: 'POST',
        url: '/api/chats/search',
        data: { query: searchQueryCanary },
      },
      extra: { searchQuery: searchQueryCanary },
    },
  });
  logger
    .child({
      extra: { nested: privateValue },
      payload: privateValue,
      secret: privateValue,
      requestId: 'request-child',
    })
    .info(privateValue);
  expect(lines.join('')).not.toContain(privateValue);
  expect(lines.join('')).not.toContain(searchQueryCanary);
  expect(JSON.parse(lines[0]!).jobId).toBe(
    '6da2c40c-2b9a-4d92-b52a-111cc548b389',
  );
  expect(JSON.parse(lines[2]!).fields).toEqual(['DATABASE_APP_URL']);
  expect(JSON.parse(lines[4]!).requestId).toBe('request-child');
});

it('propagates safe request IDs and replaces invalid ones without logging headers or bodies', async () => {
  const { lines, sink } = capture();
  const params = createLoggingOptions('api');
  const options = params.pinoHttp;
  if (!options || Array.isArray(options)) throw new Error('expected options');
  const middleware = pinoHttp(options, sink);
  const server = createServer((req, res) => {
    middleware(req, res);
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('missing address');
    const url = `http://127.0.0.1:${address.port}/?prompt=PRIVATE_SENTINEL`;
    const response = await fetch(url, {
      headers: {
        'x-request-id': 'request-123',
        authorization: 'PRIVATE_SENTINEL',
        cookie: 'PRIVATE_SENTINEL',
      },
    });
    expect(response.headers.get('x-request-id')).toBe('request-123');
    await response.text();
    const searchCanary = 'PRIVATE_SEARCH_QUERY_CANARY';
    const search = await fetch(
      `http://127.0.0.1:${address.port}/api/chats/search`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: searchCanary, limit: 10 }),
      },
    );
    await search.text();
    const invalid = await fetch(url, {
      headers: { 'x-request-id': 'bad id PRIVATE_SENTINEL' },
    });
    expect(invalid.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
    await invalid.text();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  expect(lines.join('')).not.toContain('PRIVATE_SENTINEL');
  expect(lines.join('')).not.toContain('PRIVATE_SEARCH_QUERY_CANARY');
  expect(lines.join('')).toContain('request-123');
});

it('a search term never appears in captured logs or spans', async () => {
  const term = 'zebra-unique-term';
  const { lines, sink } = capture();
  const options = createLoggingOptions('api').pinoHttp;
  if (!options || Array.isArray(options)) throw new Error('expected options');
  const middleware = pinoHttp(options, sink);
  const server = createServer((req, res) => {
    middleware(req, res);
    res.statusCode = 404;
    res.end('no');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('address');
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/platform/accounts?query=${term}`,
    );
    await response.text();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const span = provider
    .getTracer('http')
    .startSpan(`GET /accounts?query=${term}`);
  span.setAttributes({
    'http.target': `/api/platform/accounts?query=${term}`,
    'url.query': `query=${term}`,
    'url.full': `http://x/api/platform/accounts?query=${term}`,
    query: term,
    status: 'succeeded',
  });
  span.end();
  await provider.forceFlush();
  const exported = sanitizeAiSpans(exporter.getFinishedSpans(), 'api');
  expect(lines.join('')).not.toContain(term);
  expect(
    JSON.stringify(exported.map((s) => [s.name, s.attributes])),
  ).not.toContain(term);
  await provider.shutdown();
});

it('redacts query-bearing fields through the real logging options', () => {
  const { lines, sink } = capture();
  const options = createLoggingOptions('api').pinoHttp;
  if (!options || Array.isArray(options)) throw new Error('expected options');
  // Output is allowlisted, so assert redaction on the redact config itself
  // with a plain pino instance that keeps the same redact paths.
  const logger = pino(
    { ...(options.redact ? { redact: options.redact } : {}) },
    sink,
  );
  logger.info({ req: { url: '/x?query=term' }, url: { query: 'term' } });
  const output = lines.join('');
  expect(output).toContain('[REDACTED]');
  expect(output).not.toContain('term');
  const real = pino(options, sink);
  real.info({ req: { url: '/x?query=term' }, url: { query: 'term' } });
  expect(lines.join('')).not.toContain('term');
});

it('every OTel trace exporter in the backend is wrapped by the span sanitizer', async () => {
  const { readFile } = await import('node:fs/promises');
  const { globSync } = await import('node:fs');
  const files = globSync('src/**/*.ts', {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
  }).map((file) => fileURLToPath(new URL(`../../${file}`, import.meta.url)));
  const users: string[] = [];
  for (const file of files)
    if (/new (NodeSDK|OTLPTraceExporter)\(/.test(await readFile(file, 'utf8')))
      users.push(file);
  expect(users.map((f) => f.split('backend/')[1])).toEqual([
    'src/infrastructure/telemetry/ai-telemetry.ts',
  ]);
  const source = await readFile(users[0]!, 'utf8');
  expect(source).toContain('new SafeSpanExporter(');
  expect(source).toContain('traceExporter: exporter');
});
