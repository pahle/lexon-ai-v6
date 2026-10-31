import nodemailer from 'nodemailer';
import { expect, test } from 'vitest';
import { SmtpMailer } from '../../src/infrastructure/email/index.js';

const message = {
  kind: 'verification' as const,
  to: 'person@example.test',
  actionUrl: '/verify?token=test',
};
test('Nodemailer stream transport creates a real message and safe delivery state', async () => {
  const stream = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
  });
  let content = '';
  const mailer = new SmtpMailer({
    origin: 'https://lexon.example',
    from: 'lexon@example.test',
    transport: {
      sendMail: async (options) => {
        const result = await stream.sendMail(options);
        content = result.message.toString();
      },
    },
  });
  await mailer.send(message);
  await mailer.drain(1000);
  expect(content.includes('To: person@example.test')).toBe(true);
  expect(content.includes('Subject: Verify your email address')).toBe(true);
  expect(mailer.deliveryState()).toEqual({
    pending: 0,
    delivered: 1,
    failed: 0,
  });
});
test('delivery returns before SMTP completes, drain is bounded and resend can recover safely', async () => {
  let finish!: () => void;
  let fail = true;
  const blocked = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const stream = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
  });
  const mailer = new SmtpMailer({
    origin: 'https://lexon.example',
    from: 'lexon@example.test',
    transport: {
      sendMail: async (options) => {
        await blocked;
        if (fail) throw new Error('smtp://secret-sentinel@example.test');
        return stream.sendMail(options);
      },
    },
  });
  const accepted = await mailer.send(message);
  expect(accepted.messageId.length).toBeGreaterThan(0);
  expect(mailer.deliveryState().pending).toBe(1);
  await mailer.drain(1);
  expect(mailer.deliveryState().pending).toBe(1);
  finish();
  await mailer.drain(1000);
  expect(mailer.deliveryState()).toEqual({
    pending: 0,
    delivered: 0,
    failed: 1,
  });
  const leaked = JSON.stringify(mailer.deliveryState()).includes(
    'secret-sentinel',
  );
  expect(leaked).toBe(false);
  fail = false;
  await mailer.send(message);
  await mailer.drain(1000);
  expect(mailer.deliveryState()).toEqual({
    pending: 0,
    delivered: 1,
    failed: 1,
  });
});
