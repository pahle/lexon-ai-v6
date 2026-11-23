import type { AuthLimiter } from '../../src/infrastructure/queue/index.js';

// In-memory stand-in for specs that do not exercise rate limiting.
export const unlimitedLimiter: Pick<AuthLimiter, 'consume'> = {
  consume: async () => undefined,
};
