import { runAiSmoke } from '../../ai/smoke.js';

process.exitCode = await runAiSmoke({
  env: process.env,
  write: (chunk) => process.stdout.write(chunk),
});
