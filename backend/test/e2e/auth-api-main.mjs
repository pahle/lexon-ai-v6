import { createServer } from 'node:net';
import { chmod, rm } from 'node:fs/promises';
import nodemailer from 'nodemailer';
import { createApi } from '../../dist/bootstrap/api.js';
import { loadRuntimeConfig } from '../../dist/config/runtime-config.js';
import { SmtpMailer } from '../../dist/infrastructure/email/index.js';
const socketPath = '/run/lexon/health/mail-control.sock';
const config = loadRuntimeConfig('api', process.env);
const mailer = new SmtpMailer({
  origin: config.auth.origin,
  from: config.auth.smtp.from,
  transport: nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
  }),
});
const messages = [];
const app = await createApi(config, {
  email: {
    send: async (message) => {
      const result = await mailer.send(message);
      messages.push({ ...message });
      return result;
    },
    drain: (milliseconds) => mailer.drain(milliseconds),
  },
});
await rm(socketPath, { force: true });
const control = createServer((socket) => {
  socket.setEncoding('utf8');
  socket.setTimeout(2000, () => socket.destroy());
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > 1024) {
      socket.destroy();
      return;
    }
    if (!buffer.includes('\n')) return;
    try {
      const query = JSON.parse(buffer.split('\n')[0]);
      if (
        typeof query.recipient !== 'string' ||
        query.recipient.length > 254 ||
        typeof query.kind !== 'string'
      )
        throw new Error();
      const found = messages.findLast(
        (message) =>
          message.to === query.recipient && message.kind === query.kind,
      );
      socket.end(JSON.stringify(found ?? null) + '\n');
    } catch {
      socket.end('null\n');
    }
  });
});
await new Promise((resolve, reject) => {
  control.once('error', reject);
  control.listen(socketPath, resolve);
});
await chmod(socketPath, 0o600);
await app.listen(config.port, '0.0.0.0');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  await mailer.onApplicationShutdown();
  await new Promise((resolve) => control.close(resolve));
  await rm(socketPath, { force: true });
}
for (const signal of ['SIGTERM', 'SIGINT'])
  process.once(signal, () => {
    void close().catch(() => {
      process.exitCode = 1;
    });
  });
