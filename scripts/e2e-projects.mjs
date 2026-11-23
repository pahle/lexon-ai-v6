import { shouldRunChatLoad } from './chat-load-paths.mjs';

export const E2E_PROJECTS = {
  backend: [
    'runtime-health',
    'backend-api',
    'identity-api',
    'topology',
    'chat-routing',
  ],
  frontend: [
    'frontend-browser',
    // Includes F1 identity regression and F2 shell/theme/accessibility suites.
    'identity-browser',
    'chat-runtime-proof',
    'chat-browser',
    'brand-visual',
  ],
  shared: ['backend-api', 'identity-api'],
  evals: ['evaluation-smoke'],
};

// CI's three shards, balanced by measured test time (run 44889611515, test
// seconds: brand-visual-chat 192, chat-recovery 99, brand-visual-chats-settings
// 88, brand-visual-auth 60, ...). Playwright's own sharding splits by test
// count and put every brand-visual file in shard 3 (185 / 324 / 442 s). Each
// shard lists every file it runs: Playwright applies file filters to all
// selected projects. scripts/test/e2e-projects.spec.mjs proves the plan
// covers every default test exactly once, so a new spec file must be placed.
// F4.3 added local test seconds to the measured CI figures (platform console
// browser 59, platform accounts captures 42, platform organizations captures
// 19, shell-accessibility 15 moved from shard 2 to shard 1).
const e2e = (name) => `backend/test/e2e/${name}.spec.ts`;
export const E2E_SHARD_PLAN = [
  {
    // ~350 s
    projects: ['brand-visual', 'identity-api', 'identity-browser'],
    files: [
      e2e('brand-visual-chat'),
      e2e('identity-api'),
      e2e('rate-limit-proxy'),
      e2e('foreign-org-bearer'),
      e2e('platform-identity'),
      // Enrols an additional administrator (platform world). Safe after
      // platform-identity: one worker runs the projects in config order,
      // and identity-browser comes before brand-visual.
      e2e('brand-visual-platform-organizations'),
      e2e('organizations'),
      e2e('shell-accessibility'),
    ],
  },
  {
    // ~315 s
    projects: [
      'brand-visual',
      'chat-runtime-proof',
      'chat-browser',
      'identity-browser',
    ],
    files: [
      e2e('brand-visual-auth'),
      e2e('chat-runtime-proof'),
      e2e('chat-recovery'),
      e2e('indicator-trace'),
      e2e('chat-states'),
      e2e('chat-thread'),
      e2e('chat-accessibility'),
    ],
  },
  {
    // ~375 s
    projects: [
      'brand-visual',
      'identity-api',
      'topology',
      'identity-browser',
      'chat-browser',
      'runtime-health',
      'backend-api',
      'evaluation-smoke',
      'chat-routing',
      'frontend-browser',
    ],
    files: [
      e2e('brand-visual-chats-settings'),
      e2e('brand-visual-shell'),
      e2e('brand-visual-platform'),
      e2e('brand-visual-platform-accounts'),
      // Creates an administrator through setup, so it must not share a stack
      // with platform-identity (which needs the first-admin setup).
      e2e('platform-console-api'),
      // Enrols its administrators through additional setup like
      // platform-console-api.
      e2e('platform-console-browser'),
      e2e('account-invitations'),
      e2e('signup-account-invitation'),
      e2e('visual-comparison-regression'),
      e2e('topology'),
      e2e('valkey-policy'),
      e2e('account-security'),
      e2e('app-shell'),
      e2e('auth-entry'),
      e2e('invitation-entry'),
      e2e('brand-layout'),
      e2e('platform-setup-open-signup'),
      e2e('theme-before-hydration'),
      e2e('chat-copy'),
      e2e('chat-history'),
      e2e('chat-long-stress'),
      e2e('mobile-sheet'),
      e2e('runtime-health'),
      e2e('api'),
      e2e('chat-routing'),
      'frontend/test/e2e/health-page.spec.ts',
    ],
  },
];

export function composeFilesForE2EProjects(selectedProjects, repositoryRoot) {
  const files = [
    `${repositoryRoot}backend/test/e2e/compose.egress-probe.yml`,
    `${repositoryRoot}backend/test/e2e/compose.identity.yml`,
  ];
  if (
    selectedProjects.includes('chat-runtime-proof') ||
    selectedProjects.includes('chat-browser') ||
    selectedProjects.includes('brand-visual') ||
    selectedProjects.includes('chat-sse-load')
  )
    files.push(
      `${repositoryRoot}backend/test/e2e/compose.chat-runtime-proof.yml`,
    );
  if (selectedProjects.includes('chat-sse-load'))
    files.push(`${repositoryRoot}backend/test/e2e/compose.chat-load.yml`);
  return files;
}

export function resolveE2ESelection(
  rawArgs,
  mappings = E2E_PROJECTS,
  options = {},
) {
  const includeLoad = options.includeLoad ?? false;
  const args = rawArgs.filter((arg) => arg !== '--');
  let packageName;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--package') {
      packageName = args[index + 1];
      args.splice(index, 2);
      break;
    }
    if (args[index]?.startsWith('--package=')) {
      packageName = args[index].slice('--package='.length);
      args.splice(index, 1);
      break;
    }
  }

  if (packageName && !mappings[packageName])
    throw new Error('Unknown E2E package');

  const projectSelectors = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--project') {
      for (
        index += 1;
        index < args.length && !args[index].startsWith('-');
        index += 1
      )
        projectSelectors.push(args[index]);
      index -= 1;
    } else if (arg.startsWith('--project=')) {
      projectSelectors.push(arg.slice('--project='.length));
    }
  }

  const shardIndex = args.findIndex((arg) => /^--shard=\d+\/\d+$/u.test(arg));
  if (
    shardIndex >= 0 &&
    !packageName &&
    projectSelectors.length === 0 &&
    !includeLoad
  ) {
    const [shard, total] = args[shardIndex]
      .slice('--shard='.length)
      .split('/')
      .map(Number);
    const planned = E2E_SHARD_PLAN[shard - 1];
    if (total === E2E_SHARD_PLAN.length && planned) {
      args.splice(
        shardIndex,
        1,
        ...planned.projects.map((project) => `--project=${project}`),
        ...planned.files,
      );
      return { args, selectedProjects: [...planned.projects] };
    }
  }

  if (packageName && projectSelectors.length === 0)
    for (const project of mappings[packageName])
      args.push('--project', project);

  const allProjects = [...new Set(Object.values(mappings).flat())];
  const loadAllowed =
    includeLoad &&
    (!Object.hasOwn(options, 'loadTrigger') ||
      shouldRunChatLoad(options.loadTrigger));
  const selectableProjects = loadAllowed
    ? [...allProjects, 'chat-sse-load']
    : allProjects;
  const selectedProjects =
    projectSelectors.length > 0
      ? selectableProjects.filter((project) =>
          projectSelectors.some((selector) =>
            matchesProject(project, selector),
          ),
        )
      : packageName
        ? [...mappings[packageName]]
        : allProjects;

  return { args, selectedProjects };
}

function matchesProject(project, selector) {
  const pattern = new RegExp(
    `^${selector.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`,
    'i',
  );
  return pattern.test(project);
}
