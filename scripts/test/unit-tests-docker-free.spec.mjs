import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { test } from 'node:test';

// `pnpm test:unit` must run without Docker (audit A-18). A Vitest project is
// a Testcontainers project when its global setup or setup files reach the
// `testcontainers` package through static or dynamic imports. Test files are
// not scanned: unit specs may import the infrastructure module to exercise it
// with an injected fake acquisition, which starts no container. A setup that
// starts Docker without importing `testcontainers` (for example through
// child_process) is out of scope; such a setup must not join test:unit.

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(path, 'utf8');
const strings = (source) =>
  [...source.matchAll(/'([^']+)'/g)].map((match) => match[1]);
function arrayOf(source, key) {
  if (!new RegExp(`\\b${key}:`).test(source)) return [];
  const body = source.match(new RegExp(`\\b${key}:\\s*\\[([^\\]]*)\\]`))?.[1];
  assert.ok(
    body !== undefined && /^(?:\s*'[^']*'\s*,?)*\s*$/.test(body),
    `${key} must be an array of single-quoted literals so this guard can read it`,
  );
  return strings(body);
}

const workspaces = new Map(
  ['backend', 'frontend', 'shared', 'evals'].map((dir) => {
    const manifest = JSON.parse(read(join(root, dir, 'package.json')));
    return [manifest.name, { dir: join(root, dir), manifest }];
  }),
);

function sourceOf(file) {
  for (const candidate of [
    file,
    file.replace(/\.js$/, '.ts'),
    file.replace(/\.js$/, '.tsx'),
    `${file}.ts`,
    `${file}.tsx`,
    join(file, 'index.ts'),
  ])
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return undefined;
}

function resolveWorkspace(specifier) {
  const [scope, name, ...rest] = specifier.split('/');
  const workspace = workspaces.get(`${scope}/${name}`);
  if (!workspace) return undefined;
  const entry = workspace.manifest.exports?.[['.', ...rest].join('/')];
  const target = typeof entry === 'string' ? entry : entry?.import;
  if (!target) return undefined;
  return sourceOf(join(workspace.dir, target.replace(/^\.\/dist\//, './src/')));
}

const reachCache = new Map();
function reachesTestcontainers(file, seen = new Set()) {
  if (reachCache.has(file)) return reachCache.get(file);
  if (seen.has(file)) return false;
  seen.add(file);
  const specifiers = [
    ...read(file).matchAll(
      /(?:^|[^\w.])(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm,
    ),
  ].map((match) => match[1] ?? match[2]);
  const result = specifiers.some((specifier) => {
    if (/^(?:testcontainers|@testcontainers\/)/.test(specifier)) return true;
    const target = specifier.startsWith('.')
      ? sourceOf(resolve(dirname(file), specifier))
      : specifier.startsWith('@lexon/')
        ? resolveWorkspace(specifier)
        : undefined;
    return target !== undefined && reachesTestcontainers(target, seen);
  });
  reachCache.set(file, result);
  return result;
}

function vitestProjects() {
  const config = read(join(root, 'vitest.config.ts'));
  return arrayOf(config, 'projects').map((path) => {
    const file = join(root, path);
    const source = read(file);
    const base = dirname(file);
    const name = source.match(/name:\s*'([^']+)'/)?.[1];
    assert.ok(name, `${path} must declare a project name`);
    const entries = [
      ...arrayOf(source, 'globalSetup'),
      ...arrayOf(source, 'setupFiles'),
    ].map((entry) => resolve(base, entry));
    const modules = entries.map((entry) => sourceOf(entry));
    assert.ok(modules.every(Boolean), `${path} has unresolved setup files`);
    return {
      name,
      config: relative(root, file),
      testcontainers: modules.some((module) => reachesTestcontainers(module)),
    };
  });
}

function selectedProjects(script, names) {
  const filters = [...script.matchAll(/--project[=\s]+'?([^'\s]+)'?/g)].map(
    (match) => match[1],
  );
  for (const filter of filters)
    assert.match(filter, /^!?[\w-]+$/, `unsupported --project ${filter}`);
  const include = filters.filter((filter) => !filter.startsWith('!'));
  const exclude = filters
    .filter((filter) => filter.startsWith('!'))
    .map((filter) => filter.slice(1));
  return names.filter(
    (name) =>
      (include.length === 0 || include.includes(name)) &&
      !exclude.includes(name),
  );
}

test('the detector recognises the known Testcontainers projects', () => {
  const flagged = vitestProjects()
    .filter((project) => project.testcontainers)
    .map((project) => project.name);
  assert.ok(flagged.includes('backend-integration'), flagged.join(', '));
  assert.ok(flagged.includes('evals'), flagged.join(', '));
});

test('the root Vitest global setup does not need Docker', () => {
  const config = read(join(root, 'vitest.config.ts'));
  for (const entry of arrayOf(config, 'globalSetup'))
    assert.equal(reachesTestcontainers(sourceOf(join(root, entry))), false);
});

test('pnpm test:unit selects no Testcontainers project', () => {
  const script = JSON.parse(read(join(root, 'package.json'))).scripts[
    'test:unit'
  ];
  const projects = vitestProjects();
  const selected = selectedProjects(
    script,
    projects.map((project) => project.name),
  );
  assert.ok(selected.length > 0, 'test:unit selects no project');
  const docker = projects.filter(
    (project) => project.testcontainers && selected.includes(project.name),
  );
  assert.deepEqual(
    docker.map((project) => `${project.name} (${project.config})`),
    [],
  );
});
