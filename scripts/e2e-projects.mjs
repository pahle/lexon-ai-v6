export const E2E_PROJECTS = {
  backend: ['runtime-health', 'backend-api', 'identity-api', 'topology'],
  frontend: [
    'frontend-browser',
    // Includes F1 identity regression and F2 shell/theme/accessibility suites.
    'identity-browser',
  ],
  shared: ['backend-api', 'identity-api'],
  evals: ['evaluation-smoke'],
};
