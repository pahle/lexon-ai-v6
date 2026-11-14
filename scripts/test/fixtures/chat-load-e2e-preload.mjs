import { appendFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SYNTHETIC_OBSERVATIONS } from './chat-load-observations.mjs';

if (process.argv[1]?.endsWith('/node_modules/@playwright/test/cli.js')) {
  const load = process.env.LEXON_CHAT_LOAD === '1';
  const descriptor = process.env.LEXON_E2E_DESCRIPTOR;
  if (load && descriptor) {
    const stack = JSON.parse(descriptor);
    const observationPath = join(
      dirname(stack.operatorEnvironmentPath),
      'chat-load-observations.json',
    );
    writeFileSync(observationPath, JSON.stringify(SYNTHETIC_OBSERVATIONS), {
      mode: 0o600,
    });
    appendFileSync(
      process.env.CHAT_LOAD_TEST_EVENT_LOG,
      `${JSON.stringify({ event: 'playwright', observationPath })}\n`,
    );
  }
  process.exit(Number(process.env.CHAT_LOAD_TEST_PLAYWRIGHT_EXIT ?? 0));
}
