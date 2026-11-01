import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { test } from '../setup/file-services.js';
import { createAdminSetupFixture } from '../../src/infrastructure/db/testing/admin-setup-fixture.js';
test('two actual operator CLI processes reserve at most one initial administrator and send one SMTP link', async ({
  services,
}) => {
  const fixture = await createAdminSetupFixture(services);
  let messages = 0;
  const smtp = createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write('220 localhost test SMTP\r\n');
    let buffer = '';
    let data = false;
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (true) {
        if (data) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          messages++;
          buffer = buffer.slice(end + 5);
          data = false;
          socket.write('250 accepted\r\n');
          continue;
        }
        const end = buffer.indexOf('\r\n');
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (line.startsWith('EHLO') || line.startsWith('HELO'))
          socket.write('250 localhost\r\n');
        else if (line === 'DATA') {
          data = true;
          socket.write('354 continue\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 goodbye\r\n');
          return;
        } else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  const address = smtp.address();
  if (!address || typeof address === 'string')
    throw new Error('SMTP fixture unavailable');
  const emails = [
    `${randomUUID()}@example.test`,
    `${randomUUID()}@example.test`,
  ];
  const env = {
    PATH: process.env.PATH,
    LEXON_SETUP_DATABASE_URL: fixture.url,
    AUTH_PUBLIC_ORIGIN: 'http://localhost:3000',
    AUTH_AUDIT_HMAC_SECRET: 'c'.repeat(48),
    AUTH_AUDIT_HMAC_KEY_ID: 'cli-test',
    SMTP_URL: `smtp://127.0.0.1:${address.port}`,
    SMTP_FROM: 'lexon@example.test',
  };
  try {
    const command = new URL(
      '../../dist/entrypoints/admin-setup/main.js',
      import.meta.url,
    ).pathname;
    const outcomes = await Promise.all(
      emails.map((email) =>
        promisify(execFile)(process.execPath, [command, '--email', email], {
          env,
          timeout: 15000,
        }).then(
          (result) => result.stdout,
          (error: unknown) => (error as { stdout: string }).stdout,
        ),
      ),
    );
    expect(outcomes.sort()).toEqual([
      'Administrator setup: created\n',
      'Administrator setup: refused\n',
    ]);
    expect(messages).toBe(1);
    expect(await fixture.auditCount()).toBe(2);
    expect(
      (
        await Promise.all(emails.map((email) => fixture.pendingCount(email)))
      ).reduce((a, b) => a + b, 0),
    ).toBe(1);
    for (const output of outcomes)
      for (const email of emails) expect(output).not.toContain(email);
  } finally {
    await fixture.close();
    await new Promise<void>((resolve, reject) =>
      smtp.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
