import { z } from 'zod';
import { RuntimeConfigurationError } from './configuration-error.js';

const schema = z.object({
  CHAT_SSE_CONNECTIONS_PER_USER: z.coerce
    .number()
    .int()
    .positive()
    .max(512)
    .default(6),
  CHAT_DELETE_GRACE_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(300_000)
    .default(30_000),
  CHAT_DELETE_TARGET_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(600_000)
    .default(60_000),
});

export interface ChatConfig {
  maxConnectionsPerUser: number;
  xreadBlockMs: 1000;
  heartbeatMs: 15000;
  subscriberQueueBytes: 65536;
  drainTimeoutMs: 5000;
  deleteGraceMs: number;
  deleteTargetMs: number;
}

export function readChatConfig(
  env: Record<string, string | undefined>,
): ChatConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new RuntimeConfigurationError([
      ...new Set(parsed.error.issues.map((issue) => issue.path.join('.'))),
    ]);
  if (parsed.data.CHAT_DELETE_TARGET_MS < parsed.data.CHAT_DELETE_GRACE_MS)
    throw new RuntimeConfigurationError(['CHAT_DELETE_TARGET_MS']);
  return {
    maxConnectionsPerUser: parsed.data.CHAT_SSE_CONNECTIONS_PER_USER,
    xreadBlockMs: 1000,
    heartbeatMs: 15000,
    subscriberQueueBytes: 65536,
    drainTimeoutMs: 5000,
    deleteGraceMs: parsed.data.CHAT_DELETE_GRACE_MS,
    deleteTargetMs: parsed.data.CHAT_DELETE_TARGET_MS,
  };
}
