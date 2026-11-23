import { expect, it } from 'vitest';
import { createLoggingOptions } from '../../src/infrastructure/telemetry/logging.js';

// F4.4 hardening (spec §5 item 15): conditional-request headers carry no
// secrets, but their values are per-tenant fingerprints — the redact list must
// cover them should the serializers ever emit headers.
it('request and response validator headers are on the redact list', () => {
  const { pinoHttp } = createLoggingOptions('api');
  const paths = pinoHttp.redact;
  const list = Array.isArray(paths)
    ? paths
    : (paths as { paths: string[] }).paths;
  expect(list).toContain('req.headers.if-none-match');
  expect(list).toContain('res.headers.etag');
});
