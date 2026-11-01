export {
  EMAIL_PORT,
  type EmailPort,
  type TransactionalEmail,
  type SecurityNotice,
} from './email-port.js';
export { renderEmail } from './email-templates.js';
export { SmtpMailer, type MailTransport } from './smtp-mailer.js';
export { EmailModule } from './email.module.js';
