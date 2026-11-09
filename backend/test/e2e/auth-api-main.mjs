import { createServer } from 'node:net';
import { chmod, rm } from 'node:fs/promises';
import nodemailer from 'nodemailer';
import { createApi } from '../../dist/bootstrap/api.js';
import { loadRuntimeConfig } from '../../dist/config/runtime-config.js';
import { SmtpMailer } from '../../dist/infrastructure/email/index.js';
import { resolveClientAddress } from '../../dist/modules/identity-access/client-address.js';
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
const routingProbes = new Map();
function installChatRoutingProbe(testHttp) {
  testHttp.get('/api/e2e/chat-routing/probe', (req, res) => {
    res.set('x-lexon-test-backend', 'api').json({ path: req.originalUrl });
  });
  testHttp.get('/api/e2e/chat-routing/client-address', (req, res) => {
    res.json({
      address: resolveClientAddress(
        req.socket.remoteAddress ?? '',
        new Headers(req.headers),
        config.auth.trustedProxies,
      ),
    });
  });
  testHttp.get('/api/e2e/chat-routing/events/:probeId', async (req, res) => {
    const { probeId } = req.params;
    if (!/^[a-f0-9-]{36}$/.test(probeId)) return res.sendStatus(404);
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    const probe = {
      started: true,
      released: false,
      ended: false,
      closed: false,
      lastEventId: req.get('last-event-id') ?? null,
      cookiePresent: req.get('cookie') === 'routing=probe',
      release() {
        this.released = true;
        release();
      },
    };
    routingProbes.set(probeId, probe);
    res.once('close', () => {
      probe.closed = true;
      if (!probe.released) probe.release();
    });
    res.status(200).set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    res.flushHeaders();
    res.write('id: frame-a\ndata: frame A\n\n');
    await blocked;
    if (res.destroyed) return;
    res.write('id: frame-b\ndata: frame B\n\n');
    res.end();
    probe.ended = true;
  });
  testHttp.get('/api/e2e/chat-routing/control/:probeId', (req, res) => {
    const probe = routingProbes.get(req.params.probeId);
    if (!probe) return res.sendStatus(404);
    res.json({
      started: probe.started,
      released: probe.released,
      ended: probe.ended,
      lastEventId: probe.lastEventId,
      cookiePresent: probe.cookiePresent,
    });
  });
  testHttp.post('/api/e2e/chat-routing/release/:probeId', (req, res) => {
    const probe = routingProbes.get(req.params.probeId);
    if (!probe) return res.sendStatus(404);
    probe.release();
    res.sendStatus(204);
  });
}
const app = await createApi(config, {
  email: {
    send: async (message) => {
      const result = await mailer.send(message);
      messages.push({ ...message });
      return result;
    },
    drain: (milliseconds) => mailer.drain(milliseconds),
  },
  testOnlyHttpMiddleware: installChatRoutingProbe,
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
