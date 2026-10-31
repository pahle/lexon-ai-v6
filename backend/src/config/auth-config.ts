import { z } from 'zod';
import { RuntimeConfigurationError } from './configuration-error.js';
import { readAuthRateRules, readTrustedProxies } from './auth-rate-config.js';

const duration = (seconds: number) =>
  z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .default(seconds);
const boolean = (value: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(value)
    .transform((input) => input === 'true');
const secret = z.string().refine((value) => Buffer.byteLength(value) >= 32);
const url = (protocols: string[]) =>
  z
    .string()
    .refine(
      (value) =>
        URL.canParse(value) && protocols.includes(new URL(value).protocol),
    );
const schema = z.object({
  AUTH_PUBLIC_ORIGIN: url(['http:', 'https:']).refine(
    (value) => URL.canParse(value) && new URL(value).origin === value,
  ),
  AUTH_SECRET: secret,
  AUTH_AUDIT_HMAC_SECRET: secret,
  AUTH_AUDIT_HMAC_KEY_ID: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  AUTH_OPEN_SIGNUP: boolean('true'),
  AUTH_LOCAL_DEVELOPMENT: boolean('false'),
  AUTH_COOKIE_SECONDS: duration(604800),
  AUTH_COOKIE_REFRESH_SECONDS: duration(86400),
  AUTH_REAUTH_SECONDS: duration(300),
  AUTH_BEARER_SECONDS: duration(900),
  AUTH_SETUP_SECONDS: duration(86400),
  AUTH_INVITATION_SECONDS: duration(1209600),
  AUTH_VERIFICATION_SECONDS: duration(3600),
  AUTH_RESET_SECONDS: duration(1800),
  DATABASE_AUTH_URL: url(['postgres:', 'postgresql:']),
  SMTP_URL: url(['smtp:', 'smtps:']),
  SMTP_FROM: z.email(),
});
export function readAuthConfig(env: Record<string, string | undefined>) {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new RuntimeConfigurationError([
      ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
    ]);
  const value = result.data;
  const invalid: string[] = [];
  if (value.AUTH_SECRET === value.AUTH_AUDIT_HMAC_SECRET)
    invalid.push('AUTH_AUDIT_HMAC_SECRET');
  if (value.AUTH_COOKIE_REFRESH_SECONDS > value.AUTH_COOKIE_SECONDS)
    invalid.push('AUTH_COOKIE_REFRESH_SECONDS');
  const origin = new URL(value.AUTH_PUBLIC_ORIGIN);
  const secureCookies = origin.protocol === 'https:';
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(
    origin.hostname,
  );
  if (!secureCookies && !(value.AUTH_LOCAL_DEVELOPMENT && loopback))
    invalid.push('AUTH_PUBLIC_ORIGIN', 'AUTH_LOCAL_DEVELOPMENT');
  if (invalid.length) throw new RuntimeConfigurationError(invalid);
  return {
    origin: value.AUTH_PUBLIC_ORIGIN,
    secret: value.AUTH_SECRET,
    auditHmacSecret: value.AUTH_AUDIT_HMAC_SECRET,
    auditHmacKeyId: value.AUTH_AUDIT_HMAC_KEY_ID,
    openSignup: value.AUTH_OPEN_SIGNUP,
    localDevelopment: value.AUTH_LOCAL_DEVELOPMENT,
    secureCookies,
    cookieSeconds: value.AUTH_COOKIE_SECONDS,
    cookieRefreshSeconds: value.AUTH_COOKIE_REFRESH_SECONDS,
    reauthSeconds: value.AUTH_REAUTH_SECONDS,
    bearerSeconds: value.AUTH_BEARER_SECONDS,
    setupSeconds: value.AUTH_SETUP_SECONDS,
    invitationSeconds: value.AUTH_INVITATION_SECONDS,
    verificationSeconds: value.AUTH_VERIFICATION_SECONDS,
    resetSeconds: value.AUTH_RESET_SECONDS,
    database: { authUrl: value.DATABASE_AUTH_URL },
    smtp: { url: value.SMTP_URL, from: value.SMTP_FROM },
    rateRules: readAuthRateRules(env.AUTH_RATE_RULES_JSON),
    trustedProxies: readTrustedProxies(env.AUTH_TRUSTED_PROXIES),
  };
}
export type AuthConfig = ReturnType<typeof readAuthConfig>;
