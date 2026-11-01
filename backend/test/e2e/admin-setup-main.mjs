import nodemailer from 'nodemailer';
import { runAdminSetup } from '../../dist/modules/identity-access/admin-setup.service.js';
import { parseAdminSetupArgs } from '../../dist/modules/identity-access/admin-setup-policy.js';
import { createAdminSetupOperator } from '../../dist/infrastructure/db/index.js';
import { SmtpMailer } from '../../dist/infrastructure/email/index.js';
let operator;
let mailer;
try {
  const input = parseAdminSetupArgs(process.argv.slice(2));
  operator = await createAdminSetupOperator(
    process.env.LEXON_SETUP_DATABASE_URL,
  );
  mailer = new SmtpMailer({
    origin: process.env.AUTH_PUBLIC_ORIGIN,
    from: process.env.SMTP_FROM,
    transport: nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
    }),
  });
  let captured = null;
  const result = await runAdminSetup(input, {
    operator,
    origin: process.env.AUTH_PUBLIC_ORIGIN,
    setupSeconds: Number(process.env.AUTH_SETUP_SECONDS ?? 86400),
    auditSecret: process.env.AUTH_AUDIT_HMAC_SECRET,
    auditKeyId: process.env.AUTH_AUDIT_HMAC_KEY_ID,
    send: async ({ email, url }) => {
      const message = { kind: 'admin-setup', to: email, actionUrl: url };
      await mailer.send(message);
      captured = message;
    },
  });
  await mailer.drain(2000);
  // Privileged test-control response, consumed in memory by the host fixture.
  process.stdout.write(JSON.stringify({ ...result, mail: captured }));
} catch {
  process.stderr.write('Test operator setup unavailable\n');
  process.exitCode = 1;
} finally {
  await mailer?.onApplicationShutdown();
  await operator?.close();
}
