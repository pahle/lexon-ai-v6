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
    'visual-review',
  ],
  shared: ['backend-api', 'identity-api'],
  evals: ['evaluation-smoke'],
};
