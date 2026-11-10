import { z } from 'zod';
import { RuntimeConfigurationError } from './configuration-error.js';

const schema = z.object({
  CHAT_SSE_CONNECTIONS_PER_USER: z.coerce
    .number()
    .int()
    .positive()
    .max(512)
    .default(6),
});

export interface ChatConfig {
  maxConnectionsPerUser: number;
  xreadBlockMs: 1000;
  heartbeatMs: 15000;
  subscriberQueueBytes: 65536;
  drainTimeoutMs: 5000;
}

export function readChatConfig(
  env: Record<string, string | undefined>,
): ChatConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new RuntimeConfigurationError([
      ...new Set(parsed.error.issues.map((issue) => issue.path.join('.'))),
    ]);
  return {
    maxConnectionsPerUser: parsed.data.CHAT_SSE_CONNECTIONS_PER_USER,
    xreadBlockMs: 1000,
    heartbeatMs: 15000,
    subscriberQueueBytes: 65536,
    drainTimeoutMs: 5000,
  };
}
