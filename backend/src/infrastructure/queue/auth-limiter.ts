import { isIP } from 'node:net';
import { Redis } from 'ioredis';
import { RateLimiterRedis, RateLimiterRes } from 'rate-limiter-flexible';
import {
  AUTH_LIMIT_ACTIONS,
  DEFAULT_AUTH_RATE_RULES,
  type AuthLimitAction,
  type AuthRateRules,
} from '../../config/auth-rate-config.js';
export type {
  AuthLimitAction,
  AuthRateRules,
} from '../../config/auth-rate-config.js';
import { AuthLimitError } from './auth-limit-error.js';
export interface AuthLimiterOptions {
  url: string;
  prefix?: string;
  rules?: AuthRateRules;
}
type ActionLimits = Record<
  AuthLimitAction,
  { account: RateLimiterRedis; ip: RateLimiterRedis }
>;

export class AuthLimiter {
  readonly #client: Redis;
  readonly #limits: ActionLimits;
  private constructor(options: AuthLimiterOptions) {
    this.#client = new Redis(options.url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      retryStrategy: () => null,
      connectTimeout: 1000,
      commandTimeout: 1000,
    });
    // Errors are reflected by bounded consume failures, never logged with a URL.
    this.#client.on('error', () => undefined);
    const rules = options.rules ?? DEFAULT_AUTH_RATE_RULES;
    const prefix = options.prefix ?? 'rl:auth:';
    const limit = (action: AuthLimitAction, scope: 'account' | 'ip') =>
      new RateLimiterRedis({
        storeClient: this.#client,
        keyPrefix: `${prefix}${action}:${scope}`,
        points: rules[action][scope],
        duration: rules[action].windowSeconds,
        rejectIfRedisNotReady: true,
      });
    this.#limits = Object.fromEntries(
      AUTH_LIMIT_ACTIONS.map((action) => [
        action,
        { account: limit(action, 'account'), ip: limit(action, 'ip') },
      ]),
    ) as ActionLimits;
  }
  static async create(options: AuthLimiterOptions): Promise<AuthLimiter> {
    const limiter = new AuthLimiter(options);
    try {
      await limiter.#client.connect();
      return limiter;
    } catch {
      limiter.#client.disconnect();
      throw new AuthLimitError(503, 'AUTH_UNAVAILABLE');
    }
  }
  async consume(input: {
    action: AuthLimitAction;
    clientAddress: string;
    accountKey?: string;
  }): Promise<void> {
    if (
      !AUTH_LIMIT_ACTIONS.includes(input.action) ||
      !isIP(input.clientAddress) ||
      (input.accountKey !== undefined &&
        !/^[a-f0-9]{64}$/.test(input.accountKey))
    )
      throw new Error('Invalid authentication limit input');
    const limits = this.#limits[input.action];
    const requests = [limits.ip.consume(input.clientAddress)];
    if (input.accountKey !== undefined)
      requests.push(limits.account.consume(input.accountKey));
    const failures = (await Promise.allSettled(requests)).filter(
      (result) => result.status === 'rejected',
    );
    if (failures.some((result) => !(result.reason instanceof RateLimiterRes)))
      throw new AuthLimitError(503, 'AUTH_UNAVAILABLE');
    if (failures.length) throw new AuthLimitError(429, 'AUTH_RATE_LIMITED');
  }
  async close(): Promise<void> {
    this.#client.disconnect();
  }
}
