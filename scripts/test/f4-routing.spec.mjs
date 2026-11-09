import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeEnvironment } from '../compose-environment.mjs';
import { readContainerImages } from '../container-images.mjs';

const caddyImage =
  'caddy:2.11.9-alpine@sha256:0bbb055bda6793c999bde78b1b5ce3e89f829fb031af2cf50056ea1246559fee';
const k6Image =
  'grafana/k6:2.3.0@sha256:2dd4756ec6e14e62778916e1eb850108e4b499304c02df56760fa0bdb0fba0b8';

test('LEX-TS-001 v1.12 approves the exact official Caddy and k6 images', async () => {
  const spec = await readFile(
    'docs/specs/LEXON-01-TECHNOLOGY-STACK.md',
    'utf8',
  );
  assert.match(spec, /\*\*Version\*\* \| 1\.12/);
  assert.match(spec, /\*\*Date\*\* \| 9 November 2026/);
  assert.match(spec, /\*\*Supersedes\*\* \| v1\.11 \(3 November 2026\)/);
  assert.match(
    spec,
    new RegExp(caddyImage.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  assert.match(
    spec,
    new RegExp(k6Image.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  assert.match(
    spec,
    /\| 1\.12 \| \*\*Added \(product owner, F4\):\*\* Caddy 2\.11\.9/,
  );

  const manifest = await readFile('config/container-images.env', 'utf8');
  assert.match(manifest, new RegExp(`^CADDY_IMAGE=${caddyImage}$`, 'm'));
  assert.match(manifest, new RegExp(`^K6_IMAGE=${k6Image}$`, 'm'));
  const images = readContainerImages('config/container-images.env');
  assert.equal(images.caddy, caddyImage);
  assert.equal(images.k6, k6Image);
});

test('Compose environment exports approved images and the public Caddy origin', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-f4-compose-'));
  try {
    const env = await composeEnvironment(
      Object.fromEntries(
        [
          'POSTGRES_ADMIN_PASSWORD',
          'DATABASE_MIGRATOR_PASSWORD',
          'DATABASE_APP_PASSWORD',
          'DATABASE_AUTH_PASSWORD',
          'DATABASE_SETUP_PASSWORD',
          'AUTH_SECRET',
          'AUTH_AUDIT_HMAC_SECRET',
          'SMTP_URL',
          'SMTP_FROM',
          'VALKEY_PASSWORD',
          'S3_ACCESS_KEY',
          'S3_SECRET_KEY',
          'S3_BUCKET',
        ].map((key) => [key, 'test-only-' + key]),
      ),
      directory,
    );
    assert.equal(env.CADDY_IMAGE, caddyImage);
    assert.equal(env.K6_IMAGE, k6Image);
    assert.equal(env.API_HOST_PORT, '3001');
    assert.equal(env.FRONTEND_HOST_PORT, '3002');
    assert.equal(env.PUBLIC_URL, 'http://localhost:3000');
    assert.equal(env.AUTH_PUBLIC_ORIGIN, env.PUBLIC_URL);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('legacy frontend port 3000 colliding with Caddy fails before Compose starts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-f4-legacy-port-'));
  try {
    await assert.rejects(
      composeEnvironment({ FRONTEND_HOST_PORT: '3000' }, directory),
      /FRONTEND_HOST_PORT and PUBLIC_HOST_PORT both use 3000\. Set FRONTEND_HOST_PORT=3002/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('diagnostic zero ports stay ephemeral without changing the public Caddy URL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-f4-ephemeral-ports-'));
  try {
    const env = await composeEnvironment(
      {
        ...Object.fromEntries(
          [
            'POSTGRES_ADMIN_PASSWORD',
            'DATABASE_MIGRATOR_PASSWORD',
            'DATABASE_APP_PASSWORD',
            'DATABASE_AUTH_PASSWORD',
            'DATABASE_SETUP_PASSWORD',
            'AUTH_SECRET',
            'AUTH_AUDIT_HMAC_SECRET',
            'SMTP_URL',
            'SMTP_FROM',
            'VALKEY_PASSWORD',
            'S3_ACCESS_KEY',
            'S3_SECRET_KEY',
            'S3_BUCKET',
          ].map((key) => [key, 'test-only-' + key]),
        ),
        API_HOST_PORT: '0',
        FRONTEND_HOST_PORT: '0',
      },
      directory,
    );
    assert.equal(env.API_HOST_PORT, '0');
    assert.equal(env.FRONTEND_HOST_PORT, '0');
    assert.equal(env.PUBLIC_HOST_PORT, '3000');
    assert.equal(env.PUBLIC_URL, 'http://localhost:3000');
    assert.equal(env.AUTH_PUBLIC_ORIGIN, 'http://localhost:3000');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('numeric port aliases are canonicalized before collision checks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-f4-port-alias-'));
  try {
    await assert.rejects(
      composeEnvironment({ FRONTEND_HOST_PORT: '03000' }, directory),
      /FRONTEND_HOST_PORT and PUBLIC_HOST_PORT both use 3000/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('public Caddy cannot use an ephemeral host port', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-f4-public-port-'));
  try {
    await assert.rejects(
      composeEnvironment({ PUBLIC_HOST_PORT: '0' }, directory),
      /Invalid PUBLIC_HOST_PORT/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('development Caddy public URL remains plain HTTP', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lexon-f4-http-origin-'));
  try {
    await assert.rejects(
      composeEnvironment({ PUBLIC_URL: 'https://localhost:3000' }, directory),
      /Invalid public URL/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Caddy owns browser routing and Next.js has no API rewrite', async () => {
  const compose = await readFile('docker-compose.yml', 'utf8');
  const caddy = await readFile('infra/Caddyfile', 'utf8');
  const nextConfig = await readFile('frontend/next.config.ts', 'utf8');
  const projects = await readFile('playwright.config.ts', 'utf8');
  const mapping = await readFile('scripts/e2e-projects.mjs', 'utf8');

  assert.match(compose, /caddy:/);
  assert.match(compose, /\$\{CADDY_IMAGE:/);
  assert.match(compose, /127\.0\.0\.1:\$\{PUBLIC_HOST_PORT/);
  assert.match(compose, /127\.0\.0\.1:\$\{FRONTEND_HOST_PORT:-3002\}/);
  assert.match(caddy, /@api path \/api\/\*/);
  assert.match(caddy, /handle @api\s*\{\s*reverse_proxy api:3001/);
  assert.match(caddy, /reverse_proxy frontend:3000/);
  assert.match(caddy, /flush_interval -1/);
  assert.match(caddy, /read_timeout 60s/);
  assert.doesNotMatch(caddy, /response_buffers|log_credentials|\btls\b|:443/);
  assert.doesNotMatch(caddy, /^\s*log(?:\s|\{)/m);
  assert.doesNotMatch(nextConfig, /async rewrites|source:\s*['"]\/api/);
  assert.match(projects, /name: 'chat-routing'/);
  assert.match(mapping, /chat-routing/);
});

test('development and E2E descriptors use Caddy as public/auth origin and keep API diagnostics private', async () => {
  const composeEnvironmentSource = await readFile(
    'scripts/compose-environment.mjs',
    'utf8',
  );
  const dev = await readFile('scripts/dev.mjs', 'utf8');
  const e2e = await readFile('scripts/e2e.mjs', 'utf8');
  const envExample = await readFile('.env.example', 'utf8');

  assert.match(composeEnvironmentSource, /CADDY_IMAGE/);
  assert.match(composeEnvironmentSource, /K6_IMAGE/);
  assert.match(dev, /caddy/);
  assert.match(e2e, /publicUrl/);
  assert.match(e2e, /apiUrl: `http:\/\/127\.0\.0\.1:/);
  assert.match(e2e, /AUTH_PUBLIC_ORIGIN = publicUrl/);
  assert.match(envExample, /^PUBLIC_HOST_PORT=3000$/m);
});
