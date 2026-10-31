import { test, expect } from '@playwright/test';
import { descriptor, docker, containerId } from './runtime-support.js';
const connectScript = `const {connect}=await import('node:net');const socket=connect({host:process.argv[1],port:Number(process.argv[2])});const timer=setTimeout(()=>{socket.destroy();process.exit(2);},1000);socket.once('connect',()=>{clearTimeout(timer);socket.destroy();process.exit(0);});socket.once('error',()=>{clearTimeout(timer);process.exit(1);});`;
test('document worker cannot reach controlled off-network IP while core dependencies remain healthy', async () => {
  const project = descriptor().project;
  for (const [service, networks] of [
    ['document-worker', ['core', 'sandbox']],
    ['frontend', ['edge']],
  ] as const) {
    const actual = JSON.parse(
      await docker([
        'inspect',
        '--format',
        '{{json .NetworkSettings.Networks}}',
        await containerId(service),
      ]),
    );
    expect(Object.keys(actual).sort()).toEqual(
      networks.map((name) => project + '_' + name).sort(),
    );
  }
  const control = await containerId('network-control');
  const ip = await docker([
    'inspect',
    '--format',
    `{{(index .NetworkSettings.Networks "${project}_egress").IPAddress}}`,
    control,
  ]);
  expect(ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  await docker([
    'exec',
    await containerId('api'),
    'node',
    '--input-type=module',
    '-e',
    connectScript,
    ip,
    '7777',
  ]);
  let reachable = true;
  try {
    await docker([
      'exec',
      await containerId('document-worker'),
      'node',
      '--input-type=module',
      '-e',
      connectScript,
      ip,
      '7777',
    ]);
  } catch {
    reachable = false;
  }
  expect(reachable).toBe(false);
  await docker([
    'exec',
    await containerId('document-worker'),
    'node',
    'backend/dist/bootstrap/health-check.js',
    '--mode',
    'readiness',
  ]);
  for (const [host, port] of [
    ['postgres', '5432'],
    ['valkey', '6379'],
    ['seaweedfs', '8333'],
  ])
    await docker([
      'exec',
      await containerId('document-worker'),
      'node',
      '--input-type=module',
      '-e',
      connectScript,
      host!,
      port!,
    ]);
});
test('frontend env and browser assets contain no infrastructure credentials or chat route', async ({
  request,
}) => {
  const api = JSON.parse(
    await docker([
      'inspect',
      '--format',
      '{{json .Config.Env}}',
      await containerId('api'),
    ]),
  ) as string[];
  const credentials = api
    .filter((value) =>
      /^(DATABASE_APP_URL|VALKEY_.*_URL|S3_ACCESS_KEY|S3_SECRET_KEY)=/.test(
        value,
      ),
    )
    .map((value) => value.slice(value.indexOf('=') + 1));
  expect(credentials.length).toBeGreaterThan(3);
  const frontend = await containerId('frontend');
  const environment = JSON.parse(
    await docker(['inspect', '--format', '{{json .Config.Env}}', frontend]),
  ) as string[];
  expect(
    environment.some((value) =>
      /^(DATABASE_|VALKEY_|S3_|OPENROUTER_|.*API_KEY)/.test(value),
    ),
  ).toBe(false);
  const assets = await docker([
    'exec',
    frontend,
    'node',
    '--input-type=module',
    '-e',
    "import{readdir,readFile}from'node:fs/promises';const root='frontend/.next/static';async function walk(path){let text='';for(const entry of await readdir(path,{withFileTypes:true})){const name=path+'/'+entry.name;text+=entry.isDirectory()?await walk(name):await readFile(name,'utf8');}return text;}process.stdout.write(await walk(root));",
  ]);
  expect(
    credentials.some(
      (value) =>
        assets.includes(value) || environment.join('\n').includes(value),
    ),
  ).toBe(false);
  const routes = await docker([
    'exec',
    frontend,
    'node',
    '--input-type=module',
    '-e',
    "import{readFile}from'node:fs/promises';process.stdout.write(await readFile('frontend/.next/server/app-paths-manifest.json','utf8'));",
  ]);
  expect(routes).not.toContain('/api/chat');
  expect(
    (
      await request.post(descriptor().frontendUrl + '/api/chat', { data: {} })
    ).status(),
  ).toBe(404);
});
