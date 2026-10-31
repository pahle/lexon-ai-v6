export async function withOwnedStack(options) {
  if (!/^lexon-e2e-[a-f0-9]+$/.test(options.project))
    throw new Error('Invalid E2E project');
  try {
    await options.start(options.signal);
    if (options.signal?.aborted) throw new Error('E2E interrupted');
    await options.exercise(options.signal);
  } finally {
    try {
      await options.down(options.project);
    } finally {
      await options.remove(options.directory);
    }
  }
}
