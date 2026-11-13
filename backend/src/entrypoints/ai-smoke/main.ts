import { runAiSmoke } from '../../ai/smoke.js';

process.exitCode = await runAiSmoke({
  env: process.env,
  write: (chunk) => process.stdout.write(chunk),
  argv:
    process.argv.slice(2).at(0) === '--'
      ? process.argv.slice(3)
      : process.argv.slice(2),
});
