// The compose file list a stack was started with, shared by scripts/e2e.mjs
// (which writes it into the stack descriptor) and the test helpers that
// recreate services (setup-support.ts), so a recreate never drops an overlay.

export function buildStackDescriptor({
  project,
  operatorEnvironmentPath,
  apiUrl,
  publicUrl,
  composeFiles,
}) {
  return {
    project,
    operatorEnvironmentPath,
    apiUrl,
    publicUrl,
    frontendUrl: publicUrl,
    composeFiles,
  };
}

/** docker-compose.yml first, then the stack's files (identity only if absent). */
export function stackComposeFiles(stack, repositoryRoot) {
  const files =
    Array.isArray(stack.composeFiles) && stack.composeFiles.length > 0
      ? stack.composeFiles
      : [`${repositoryRoot}backend/test/e2e/compose.identity.yml`];
  return [`${repositoryRoot}docker-compose.yml`, ...files];
}
