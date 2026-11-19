import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { containerId, descriptor, docker } from './runtime-support.js';

// Two clients on the stack's edge network reach the API only through Caddy.
// Research R1e: an unresolved address falls into one shared bucket, so before
// AUTH_TRUSTED_PROXIES the second client was throttled by the first.
const signin = `
const [name, count, forwarded] = process.argv.slice(1);
const statuses = [];
for (let i = 0; i < Number(count); i++) {
  const headers = { 'content-type': 'application/json' };
  const hop = forwarded && forwarded.split(',')[i % forwarded.split(',').length];
  if (hop) headers['x-forwarded-for'] = hop;
  const response = await fetch('http://caddy:8080/api/auth/sign-in/email', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: name + '-' + i + '-' + Date.now() + '@example.test', password: 'Not-a-real-password-42!' }),
  });
  statuses.push(response.status);
}
console.log(JSON.stringify(statuses));
`;

// Fixed addresses on the edge subnet keep each client's bucket its own, even
// when Docker would otherwise hand a freed address to the next container.
async function clientAddress(host: number): Promise<string> {
  const { project } = descriptor();
  const caddy = await docker([
    'inspect',
    '--format',
    `{{(index .NetworkSettings.Networks "${project}_edge").IPAddress}}`,
    await containerId('caddy'),
  ]);
  return caddy.replace(/\.\d+$/, `.${host}`);
}

async function client(
  suffix: string,
  host: number,
  count: number,
  forwarded = '',
): Promise<number[]> {
  const { project } = descriptor();
  const name = `${project}-client-${suffix}`;
  try {
    const { stdout } = await promisify(execFile)(
      'docker',
      [
        'run',
        '--rm',
        '--name',
        name,
        '--network',
        `${project}_edge`,
        '--ip',
        await clientAddress(host),
        '--entrypoint',
        'node',
        `${project}-api`,
        '--input-type=module',
        '-e',
        signin,
        randomUUID(),
        String(count),
        forwarded,
      ],
      { timeout: 60000 },
    );
    return JSON.parse(stdout.trim().split('\n').pop()!) as number[];
  } finally {
    await docker(['rm', '-f', name]).catch(() => undefined);
  }
}

test('one client exhausting its sign-in bucket leaves another client container open', async () => {
  // Default signin rule: 30 per IP per 60 s.
  const a = await client('a', 101, 32);
  expect(a.slice(0, 30)).not.toContain(429);
  expect(a.slice(30)).toEqual([429, 429]);
  const b = await client('b', 102, 3);
  expect(b).not.toContain(429);
});

test('a client-controlled X-Forwarded-For does not move a client to a new bucket', async () => {
  const spoofed = await client('c', 103, 32, '1.1.1.1,2.2.2.2');
  expect(spoofed.slice(0, 30)).not.toContain(429);
  expect(spoofed.slice(30)).toEqual([429, 429]);
});
