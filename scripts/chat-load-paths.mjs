import { matchesGlob } from 'node:path';

const CHAT_LOAD_PATH_PATTERNS = [
  '.github/workflows/chat-sse-load.yml',
  'backend/src/modules/chat/run*.ts',
  'backend/src/modules/chat/step*.ts',
  'backend/src/modules/chat/chat-profiles.ts',
  'backend/src/infrastructure/queue/*.ts',
  'backend/src/bootstrap/api.ts',
  'backend/src/entrypoints/api/root.module.ts',
  'backend/src/config/**',
  'backend/test/load/**',
  'backend/test/e2e/*load*',
  'backend/test/e2e/chat-sse-load.spec.ts',
  'backend/test/e2e/compose.chat-load.yml',
  'backend/test/e2e/compose.chat-runtime-proof.yml',
  'backend/test/e2e/chat-worker-main.mjs',
  'backend/test/e2e/auth-api-main.mjs',
  'backend/Dockerfile',
  'docker-compose.yml',
  'config/container-images.env',
  'package.json',
  'backend/package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'infra/Caddyfile',
  'scripts/chat-load-paths.mjs',
  'scripts/chat-load-evidence.mjs',
  'scripts/e2e-projects.mjs',
  'scripts/e2e.mjs',
  'scripts/e2e-lifecycle.mjs',
  'scripts/container-images.d.mts',
  'scripts/compose-runner.mjs',
  'scripts/compose-environment.mjs',
  'scripts/container-images.mjs',
  'scripts/test/chat-load-*.spec.mjs',
  'scripts/test/fixtures/chat-load-*.mjs',
  'scripts/test/chat-load-paths.spec.mjs',
  'scripts/test/chat-load-evidence.spec.mjs',
  'playwright.config.ts',
  'shared/src/chat.ts',
  'shared/src/ai-run.ts',
  'shared/src/index.ts',
];

export function shouldRunChatLoad(trigger) {
  if (!trigger || typeof trigger !== 'object') return false;
  if (trigger.eventName === 'workflow_dispatch') return true;
  if (trigger.eventName !== 'push' || !Array.isArray(trigger.changedPaths))
    return false;
  return trigger.changedPaths.some(
    (path) =>
      typeof path === 'string' &&
      CHAT_LOAD_PATH_PATTERNS.some((pattern) => matchesGlob(path, pattern)),
  );
}
