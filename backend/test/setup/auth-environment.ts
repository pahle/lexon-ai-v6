import { randomBytes } from 'node:crypto';
import type { FileServices } from './provided-context.js';
import { runtimeEnvironment } from './runtime-environment.js';

export function authConfigEnvironment(): Record<string, string> {
  return {
    AUTH_PUBLIC_ORIGIN: 'http://localhost:3000',
    AUTH_LOCAL_DEVELOPMENT: 'true',
    AUTH_SECRET: randomBytes(48).toString('base64url'),
    AUTH_AUDIT_HMAC_SECRET: randomBytes(48).toString('base64url'),
    AUTH_AUDIT_HMAC_KEY_ID: 'test-v1',
    DATABASE_AUTH_URL: 'postgresql://auth:test@localhost/lexon_test',
    SMTP_URL: 'smtp://localhost:2525',
    SMTP_FROM: 'lexon@example.test',
  };
}
export function createAuthEnvironment(
  services: FileServices,
  healthPath: string,
): Record<string, string> {
  return {
    ...runtimeEnvironment(services, healthPath),
    ...authConfigEnvironment(),
    DATABASE_AUTH_URL: services.authUrl,
  };
}
