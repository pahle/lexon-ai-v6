import { createServer } from 'node:http';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import { expect, it } from 'vitest';
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
  logger
    .child({
      extra: { nested: privateValue },
      payload: privateValue,
      secret: privateValue,
      requestId: 'request-child',
    })
    .info(privateValue);
  expect(lines.join('')).not.toContain(privateValue);
  expect(JSON.parse(lines[0]!).jobId).toBe(
    '6da2c40c-2b9a-4d92-b52a-111cc548b389',
  );
  expect(JSON.parse(lines[2]!).fields).toEqual(['DATABASE_APP_URL']);
  expect(JSON.parse(lines[3]!).requestId).toBe('request-child');
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
  expect(lines.join('')).toContain('request-123');
});
