import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const renovate = JSON.parse(read('renovate.json'));
const workflow = read('.github/workflows/supply-chain.yml');

// The npm dependencies Renovate sees: every workspace manifest plus the
// pnpm-workspace.yaml overrides.
const npmDeps = (() => {
  const names = new Set();
  for (const dir of ['', 'backend/', 'frontend/', 'shared/', 'evals/']) {
    const pkg = JSON.parse(read(`${dir}package.json`));
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies'])
      Object.keys(pkg[field] ?? {}).forEach((name) => names.add(name));
  }
  const overrides = /^overrides:\n((?: {2}.+\n)+)/mu.exec(
    read('pnpm-workspace.yaml'),
  );
  for (const line of overrides[1].split('\n').filter(Boolean))
    names.add(line.trim().split(/:\s/u)[0].replaceAll("'", ''));
  return [...names].filter((name) => !name.startsWith('#'));
})();

// Minimal model of Renovate's packageName matching: exact names, `scope/**`
// globs, `/regex/`, and `!` negations (https://docs.renovatebot.com/string-pattern-matching/).
function matchesName(patterns, name) {
  const hit = (p) =>
    /^\/.+\/$/u.test(p)
      ? new RegExp(p.slice(1, -1), 'u').test(name)
      : p.endsWith('/**')
        ? name.startsWith(p.slice(0, -2))
        : p === name;
  const positive = patterns.filter((p) => !p.startsWith('!'));
  const negative = patterns.filter((p) => p.startsWith('!'));
  return (
    (positive.length === 0 || positive.some(hit)) &&
    !negative.some((p) => hit(p.slice(1)))
  );
}

// Later rules override earlier ones; labels and addLabels merge.
function resolveNpm(name) {
  const result = { groupName: undefined, labels: [] };
  for (const rule of renovate.packageRules ?? []) {
    if (rule.matchDatasources && !rule.matchDatasources.includes('npm'))
      continue;
    if (rule.matchManagers && !rule.matchManagers.includes('npm')) continue;
    if (rule.matchUpdateTypes) continue;
    if (!rule.matchPackageNames || !matchesName(rule.matchPackageNames, name))
      continue;
    if (rule.groupName) result.groupName = rule.groupName;
    result.labels.push(...(rule.labels ?? []), ...(rule.addLabels ?? []));
  }
  return result;
}

test('renovate keeps exact pins', () => {
  assert.equal(renovate.rangeStrategy, 'pin');
  for (const rule of renovate.packageRules ?? [])
    assert.ok(
      rule.rangeStrategy === undefined || rule.rangeStrategy === 'pin',
      `${JSON.stringify(rule.matchPackageNames)} must not loosen pins`,
    );
});

test('renovate runs on a weekly cron schedule', () => {
  assert.equal(renovate.schedule.length, 1);
  assert.match(renovate.schedule[0], /^\* [\d,-]+ \* \* [0-6]$/u);
  assert.equal(typeof renovate.timezone, 'string');
  for (const rule of renovate.packageRules ?? [])
    assert.equal(rule.schedule, undefined, 'no rule widens the schedule');
});

test('renovate never automerges', () => {
  assert.equal(renovate.automerge, false);
  assert.ok(!(renovate.extends ?? []).some((p) => /automerge/iu.test(p)));
  for (const rule of renovate.packageRules ?? [])
    assert.notEqual(rule.automerge, true);
  for (const key of ['major', 'minor', 'patch', 'pin', 'digest'])
    assert.notEqual(renovate[key]?.automerge, true);
  assert.notEqual(renovate.lockFileMaintenance?.automerge, true);
});

const GROUPS = {
  'assistant-ui': [/^@assistant-ui\//u, /^assistant-(?:stream|cloud)$/u],
  'ai-sdk': [/^ai$/u, /^@ai-sdk\//u],
  'better-auth': [/^better-auth$/u, /^@better-auth\//u],
  nestjs: [/^@nestjs\//u],
  'next-react': [/^next$/u, /^react$/u, /^react-dom$/u],
  playwright: [/^@playwright\/test$/u, /^playwright-core$/u],
};

for (const [group, patterns] of Object.entries(GROUPS)) {
  test(`renovate groups ${group} updates`, () => {
    const members = npmDeps.filter((n) => patterns.some((re) => re.test(n)));
    assert.ok(members.length > 0, `the workspace uses ${group} packages`);
    for (const name of members)
      assert.equal(resolveNpm(name).groupName, group, name);
  });
}

test('AI SDK and model-provider updates are labelled needs-evals', () => {
  const aiPackages = npmDeps.filter(
    (n) => /^ai$|^@ai-sdk\//u.test(n) || /ai-sdk-provider$/u.test(n),
  );
  assert.ok(aiPackages.includes('ai'));
  assert.ok(aiPackages.includes('@openrouter/ai-sdk-provider'));
  for (const name of aiPackages)
    assert.ok(resolveNpm(name).labels.includes('needs-evals'), name);
  for (const name of ['next', '@nestjs/core', 'better-auth', 'zod'])
    assert.ok(!resolveNpm(name).labels.includes('needs-evals'), name);
});

test('renovate pins and updates Docker digests, including the image manifest', () => {
  assert.equal(renovate.pinDigests, true);
  assert.notEqual(renovate.digest?.enabled, false);
  for (const rule of renovate.packageRules ?? [])
    assert.notEqual(rule.enabled === false && rule.matchUpdateTypes, true);
  const manifest = read('config/container-images.env');
  const expected = manifest
    .split('\n')
    .filter((line) => /^[A-Z0-9]+_IMAGE=/u.test(line))
    .map((line) => {
      const [, image] = line.split('=');
      const [ref, digest] = image.split('@');
      const at = ref.lastIndexOf(':');
      return [ref.slice(0, at), ref.slice(at + 1), digest];
    });
  assert.equal(expected.length, 7);
  const managers = (renovate.customManagers ?? []).filter(
    (m) =>
      m.customType === 'regex' &&
      m.managerFilePatterns.some((p) =>
        new RegExp(p.slice(1, -1), 'u').test('config/container-images.env'),
      ),
  );
  assert.equal(managers.length, 1, 'one regex manager reads the manifest');
  const [manager] = managers;
  assert.equal(manager.datasourceTemplate, 'docker');
  const found = manager.matchStrings.flatMap((source) =>
    [...manifest.matchAll(new RegExp(source, 'gu'))].map(({ groups }) => [
      groups.depName,
      groups.currentValue,
      groups.currentDigest,
    ]),
  );
  assert.deepEqual(found, expected);
});

test('supply-chain workflow runs on pull requests and pushes to main only', () => {
  assert.match(
    workflow,
    /^on:\n {2}pull_request:\n {2}push:\n {4}branches:\n {6}- main\n(?=\S)/mu,
  );
  assert.doesNotMatch(workflow, /pull_request_target:/u);
  assert.match(workflow, /^permissions:\n {2}contents: read\n/mu);
  assert.doesNotMatch(workflow, /: write\b/u);
  assert.doesNotMatch(workflow, /continue-on-error/u);
  for (const job of jobBlocks(workflow))
    assert.match(job, /timeout-minutes: \d+/u);
});

test('OSV-Scanner gates pnpm-lock.yaml with the allowlist file', () => {
  const job = jobBlock(workflow, 'osv-scanner');
  const step = job
    .split(/\n(?= {6}- )/u)
    .find((s) => /google\/osv-scanner-action\//u.test(s));
  assert.ok(step, 'a step runs the OSV-Scanner action');
  assert.match(
    step,
    /uses: google\/osv-scanner-action\/osv-scanner-action@[0-9a-f]{40} # v\d+\.\d+\.\d+/u,
  );
  assert.match(step, /--lockfile=pnpm-lock\.yaml/u);
  assert.match(step, /--config=osv-scanner\.toml/u);
  assert.doesNotMatch(step, /^\s+if:/mu, 'the gate always runs');
  assert.doesNotMatch(step, /fail-on-vuln|--format|--output/u);
});

test('Syft writes a CycloneDX SBOM of the lockfile and uploads it', () => {
  const job = jobBlock(workflow, 'sbom');
  assert.match(
    job,
    /uses: anchore\/sbom-action@[0-9a-f]{40} # v\d+\.\d+\.\d+/u,
  );
  assert.match(job, /file: pnpm-lock\.yaml/u);
  assert.match(job, /format: cyclonedx-json/u);
  assert.match(job, /syft-version: v\d+\.\d+\.\d+\n/u);
  assert.match(job, /output-file: sbom\.cdx\.json/u);
  assert.match(job, /upload-release-assets: false/u);
  assert.match(job, /node scripts\/sbom-check\.mjs sbom\.cdx\.json/u);
  assert.match(
    job,
    /uses: actions\/upload-artifact@[0-9a-f]{40} # v\d+[\s\S]*name: sbom-cyclonedx-\$\{\{ github\.sha \}\}[\s\S]*path: sbom\.cdx\.json[\s\S]*if-no-files-found: error/u,
  );
});

test('the OSV allowlist entries each carry an id, a reason, and an expiry', () => {
  const toml = read('osv-scanner.toml');
  assert.doesNotMatch(
    toml,
    /^\[\[PackageOverrides\]\]/mu,
    'ignore by vulnerability id only',
  );
  const entries = toml
    .split(/^\[\[IgnoredVulns\]\]\n/mu)
    .slice(1)
    .map((block) =>
      Object.fromEntries(
        block
          .split('\n')
          .filter((line) => /^\w+\s*=/u.test(line))
          .map((line) => {
            const [key, ...rest] = line.split('=');
            return [key.trim(), rest.join('=').trim()];
          }),
      ),
    );
  const ids = entries.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const entry of entries) {
    assert.match(
      entry.id ?? '',
      /^"(?:GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}|CVE-\d{4}-\d+|OSV-\d{4}-\d+)"$/u,
    );
    assert.match(entry.reason ?? '', /^".{20,}"$/u, `${entry.id} has a reason`);
    assert.match(
      entry.effectiveUntil ?? '',
      /^\d{4}-\d{2}-\d{2}$/u,
      `${entry.id} expires`,
    );
    assert.ok(!Number.isNaN(Date.parse(entry.effectiveUntil)));
    assert.equal(entry.ignoreUntil, undefined, 'ignoreUntil is deprecated');
  }
});

function jobBlocks(text) {
  return text
    .slice(text.indexOf('\njobs:\n'))
    .split(/\n(?= {2}[\w-]+:\n)/u)
    .slice(1);
}

function jobBlock(text, name) {
  const job = jobBlocks(text).find((j) => j.startsWith(`  ${name}:\n`));
  assert.ok(job, `supply-chain.yml defines the ${name} job`);
  return job;
}

test('sbom-check accepts a CycloneDX SBOM with components and rejects anything else', async () => {
  const { checkSbom } = await import('../sbom-check.mjs');
  const ok = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    components: [{ name: 'a' }],
  };
  assert.equal(checkSbom(ok), 1);
  assert.throws(() => checkSbom({ ...ok, bomFormat: 'SPDX' }), /CycloneDX/u);
  assert.throws(() => checkSbom({ ...ok, components: [] }), /no components/u);
  assert.throws(() => checkSbom({ bomFormat: 'CycloneDX' }), /no components/u);
});
