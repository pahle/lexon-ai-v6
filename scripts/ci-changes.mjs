// Classifies the files a pull request changes, for CI job and step gating.
//
// - docsOnly: every changed file is prose. Markdown anywhere is prose, and so
//   is anything under docs/ except the folders CI reads as data
//   (docs/references, docs/design, docs/brand). CI still runs formatting and
//   the tooling tests (which read docs) for docs-only changes.
// - mutation*: a mutation gate's guarded paths changed: the mutated sources
//   and their modules, its tests and configs, shared/ (imported by the code
//   under test), and dependency, toolchain, and workflow files.
// Pushes, manual runs, and an unknown or empty file list run everything.
//
// CLI: node scripts/ci-changes.mjs <event> < changed-paths.txt
// writes key=value lines (GitHub step outputs) to stdout.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DATA_UNDER_DOCS = /^docs\/(?:references|design|brand)\//u;
const COMMON = [
  /^pnpm-lock\.yaml$/u,
  /^pnpm-workspace\.yaml$/u,
  /^package\.json$/u,
  /^(?:backend|frontend|shared)\/package\.json$/u,
  /^tsconfig[^/]*\.json$/u,
  /^\.github\/workflows\/ci\.yml$/u,
  /^scripts\/ci-changes\.mjs$/u,
  /^shared\//u,
];
const GUARDED = {
  mutationIdentity: [
    /^backend\/src\/modules\/identity-access\//u,
    /^backend\/src\/modules\/organizations\//u,
    /^backend\/test\/unit\/(?:identity-policy|session-evidence|invitation-policy)\.spec\.ts$/u,
    /^backend\/stryker\.identity\.config\.mjs$/u,
    /^backend\/vitest\.identity-mutation\.config\.ts$/u,
    /^backend\/package\.json$/u,
    /^backend\/tsconfig[^/]*\.json$/u,
  ],
  mutationContracts: [/^shared\//u],
  mutationIndicator: [
    /^frontend\/src\/components\/chat\/indicator\//u,
    /^frontend\/test\/indicator-sequence\.spec\.tsx$/u,
    /^frontend\/stryker\.indicator\.config\.mjs$/u,
    /^frontend\/vitest\.indicator-mutation\.config\.ts$/u,
    /^frontend\/package\.json$/u,
    /^frontend\/tsconfig[^/]*\.json$/u,
  ],
};

const isProse = (path) =>
  !path.split('/').includes('..') &&
  (/\.md$/u.test(path) ||
    (path.startsWith('docs/') && !DATA_UNDER_DOCS.test(path)));

export function classifyChanges({ event, paths }) {
  const runAll = {
    docsOnly: false,
    mutationIdentity: true,
    mutationContracts: true,
    mutationIndicator: true,
  };
  if (event !== 'pull_request' || !Array.isArray(paths) || paths.length === 0)
    return runAll;
  const touches = (patterns) =>
    paths.some((path) => [...COMMON, ...patterns].some((re) => re.test(path)));
  return {
    docsOnly: paths.every(isProse),
    mutationIdentity: touches(GUARDED.mutationIdentity),
    mutationContracts: touches(GUARDED.mutationContracts),
    mutationIndicator: touches(GUARDED.mutationIndicator),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths = readFileSync(0, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const result = classifyChanges({ event: process.argv[2], paths });
  process.stdout.write(
    [
      `docs_only=${result.docsOnly}`,
      `mutation_identity=${result.mutationIdentity}`,
      `mutation_contracts=${result.mutationContracts}`,
      `mutation_indicator=${result.mutationIndicator}`,
      `changed_files=${paths.length}`,
    ].join('\n') + '\n',
  );
}
