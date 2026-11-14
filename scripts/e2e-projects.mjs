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
    'chat-visual',
    'visual-review',
  ],
  shared: ['backend-api', 'identity-api'],
  evals: ['evaluation-smoke'],
};

export function composeFilesForE2EProjects(
  selectedProjects,
  repositoryRoot,
  visualDev = false,
) {
  const files = [
    `${repositoryRoot}backend/test/e2e/compose.egress-probe.yml`,
    `${repositoryRoot}backend/test/e2e/compose.identity.yml`,
  ];
  if (
    selectedProjects.includes('chat-runtime-proof') ||
    selectedProjects.includes('chat-browser') ||
    selectedProjects.includes('chat-visual') ||
    selectedProjects.includes('chat-sse-load')
  )
    files.push(
      `${repositoryRoot}backend/test/e2e/compose.chat-runtime-proof.yml`,
    );
  if (selectedProjects.includes('chat-sse-load'))
    files.push(`${repositoryRoot}backend/test/e2e/compose.chat-load.yml`);
  if (visualDev)
    files.push(`${repositoryRoot}backend/test/e2e/compose.visual-dev.yml`);
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
