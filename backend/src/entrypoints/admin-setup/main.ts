import { z } from 'zod';
import { parseAdminSetupArgs } from '../../modules/identity-access/admin-setup-policy.js';
import { runAdminSetup } from '../../modules/identity-access/admin-setup.service.js';
import { createAdminSetupOperator } from '../../infrastructure/db/index.js';
import { SmtpMailer } from '../../infrastructure/email/index.js';
const configSchema = z.object({
  LEXON_SETUP_DATABASE_URL: z
    .url()
    .refine((value) =>
      ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
    ),
  AUTH_PUBLIC_ORIGIN: z.url().refine((value) => {
    const url = new URL(value);
    return (
      url.origin === value &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    );
  }),
  AUTH_AUDIT_HMAC_SECRET: z.string().min(32),
  AUTH_AUDIT_HMAC_KEY_ID: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  AUTH_SETUP_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .max(31536000)
    .default(86400),
  SMTP_URL: z
    .url()
    .refine((value) => ['smtp:', 'smtps:'].includes(new URL(value).protocol)),
  SMTP_FROM: z.email(),
});
let input: ReturnType<typeof parseAdminSetupArgs> | undefined;
try {
  input = parseAdminSetupArgs(process.argv.slice(2));
} catch {
  process.stderr.write('Invalid setup arguments\n');
  process.exitCode = 2;
}
if (input) {
  let operator:
    Awaited<ReturnType<typeof createAdminSetupOperator>> | undefined;
  let mailer: SmtpMailer | undefined;
  try {
    const config = configSchema.parse(process.env);
    operator = await createAdminSetupOperator(config.LEXON_SETUP_DATABASE_URL);
    mailer = new SmtpMailer({
      origin: config.AUTH_PUBLIC_ORIGIN,
      from: config.SMTP_FROM,
      url: config.SMTP_URL,
    });
    const transport = mailer;
    const result = await runAdminSetup(input, {
      operator,
      origin: config.AUTH_PUBLIC_ORIGIN,
      setupSeconds: config.AUTH_SETUP_SECONDS,
      auditSecret: config.AUTH_AUDIT_HMAC_SECRET,
      auditKeyId: config.AUTH_AUDIT_HMAC_KEY_ID,
      send: async ({ email, url }) => {
        await transport.send({
          kind: 'admin-setup',
          to: email,
          actionUrl: url,
        });
      },
    });
    await mailer.drain(5000);
    if (mailer.deliveryState().failed > 0)
      throw new Error('Setup delivery failed');
    process.stdout.write(`Administrator setup: ${result.status}\n`);
    if (result.status === 'refused') process.exitCode = 1;
  } catch {
    process.stderr.write('Administrator setup failed\n');
    process.exitCode = 1;
  } finally {
    try {
      await operator?.close();
      await mailer?.onApplicationShutdown();
    } catch {
      process.stderr.write('Administrator setup shutdown failed\n');
      process.exitCode = 1;
    }
  }
}
