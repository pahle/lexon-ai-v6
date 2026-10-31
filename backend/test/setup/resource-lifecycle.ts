export function allowContainerReuse(
  env: Record<string, string | undefined>,
): boolean {
  const reuse = env.LEXON_TEST_REUSE === '1';
  if (reuse && env.CI) throw new Error('Container reuse is forbidden in CI');
  return reuse;
}

export async function provisionRun<T>(
  body: (register: (stop: () => Promise<unknown>) => void) => Promise<T>,
): Promise<{ value: T; stop: () => Promise<void> }> {
  const cleanups: (() => Promise<unknown>)[] = [];
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    for (const cleanup of cleanups.reverse()) {
      try {
        await cleanup();
      } catch {
        /* All remaining owned resources must still be released. */
      }
    }
  };
  try {
    const value = await body((cleanup) => cleanups.push(cleanup));
    return { value, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}
