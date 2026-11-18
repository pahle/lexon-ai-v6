import { collectChatLoadEvidence } from './chat-load-evidence.mjs';

export async function withOwnedStack(options) {
  if (!/^lexon-e2e-[a-f0-9]+$/.test(options.project))
    throw new Error('Invalid E2E project');
  // `keep` (the F4.1 visual dev loop) leaves a healthy stack running after a
  // successful exercise; a failed start or exercise is always torn down.
  let keep = options.keep === true;
  try {
    await options.start(options.signal);
    if (options.signal?.aborted) throw new Error('E2E interrupted');
    const result = await options.exercise(options.signal);
    if (options.captureChatLoad === true)
      return collectChatLoadEvidence(result);
  } catch (error) {
    keep = false;
    throw error;
  } finally {
    if (!keep)
      try {
        await options.down(options.project);
      } finally {
        await options.remove(options.directory);
      }
  }
}
