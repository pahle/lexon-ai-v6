import { EmailAddressSchema } from '@lexon/contracts';
import type { TransactionalEmail } from './email-port.js';

const subjects = {
  verification: 'Verify your email address',
  reset: 'Reset your password',
  invitation: 'You have been invited to a Lexon organization',
  'email-change': 'Confirm your new email address',
  security: 'Your Lexon account security changed',
  'admin-setup': 'Set up your Lexon platform administrator account',
};
const securityCopy = {
  password_changed: 'Your password changed.',
  email_changed: 'Your email address changed.',
  two_factor_enabled: 'Two-factor authentication is enabled.',
  two_factor_disabled: 'Two-factor authentication is disabled.',
  sessions_revoked: 'Your other sessions were revoked.',
};
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );
export function renderEmail(message: TransactionalEmail, origin: string) {
  let action: URL;
  try {
    action = new URL(message.actionUrl, origin);
    if (
      action.origin !== new URL(origin).origin ||
      action.username ||
      action.password
    )
      throw new Error();
    for (const name of [
      'callbackURL',
      'redirectTo',
      'errorCallbackURL',
      'newUserCallbackURL',
    ]) {
      const callback = action.searchParams.get(name);
      if (
        callback &&
        new URL(callback, origin).origin !== new URL(origin).origin
      )
        throw new Error();
    }
    if (!EmailAddressSchema.safeParse(message.to).success) throw new Error();
  } catch {
    throw new Error('Invalid transactional email');
  }
  const subject = subjects[message.kind];
  const greeting = message.displayName
    ? `Hello ${message.displayName},`
    : 'Hello,';
  const detail =
    message.kind === 'invitation'
      ? `You have been invited to ${message.organizationName}.`
      : message.kind === 'security'
        ? securityCopy[message.reason]
        : subject + '.';
  const url = action.href;
  return {
    to: message.to,
    subject,
    text: `${greeting}\n\n${detail}\n\nContinue: ${url}\n\nIf you did not request this, you can ignore this message.`,
    html: `<p>${escape(greeting)}</p><p>${escape(detail)}</p><p><a href="${escape(url)}">Continue in Lexon</a></p><p>If you did not request this, you can ignore this message.</p>`,
  };
}
