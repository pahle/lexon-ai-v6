import { collectChatLoadEvidence } from './chat-load-evidence.mjs';

export async function withOwnedStack(options) {
  if (!/^lexon-e2e-[a-f0-9]+$/.test(options.project))
    throw new Error('Invalid E2E project');
  try {
    await options.start(options.signal);
    if (options.signal?.aborted) throw new Error('E2E interrupted');
    const result = await options.exercise(options.signal);
    if (options.captureChatLoad === true)
      return collectChatLoadEvidence(result);
  } finally {
    try {
      await options.down(options.project);
    } finally {
      await options.remove(options.directory);
    }
  }
}
