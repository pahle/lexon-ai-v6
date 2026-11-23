import {
  ChatLoadEvidenceError,
  collectChatLoadEvidence,
} from './chat-load-evidence.mjs';

export function tagChatLoadStep(step, error) {
  if (error instanceof Error)
    try {
      error.chatLoadStep ??= step;
    } catch {
      // A non-extensible error keeps its default step.
    }
  throw error;
}

// K3 output contract: the step and error class always; the message only for
// ChatLoadEvidenceError, whose text is restricted to bound names and counts.
export function describeChatLoadFailure(error) {
  const step =
    error instanceof Error && typeof error.chatLoadStep === 'string'
      ? error.chatLoadStep
      : 'unknown';
  const className =
    error instanceof Error ? error.constructor.name : typeof error;
  const detail =
    error instanceof ChatLoadEvidenceError ? `: ${error.message}` : '';
  return `Chat SSE load E2E failed at ${step}: ${className}${detail}`;
}

export async function withOwnedStack(options) {
  if (!/^lexon-e2e-[a-f0-9]+(?:-[0-9]+)?$/.test(options.project))
    throw new Error('Invalid E2E project');
  // `keep` (the F4.1 visual dev loop) leaves a healthy stack running after a
  // successful exercise; a failed start or exercise is always torn down.
  let keep = options.keep === true;
  try {
    await options
      .start(options.signal)
      .catch((error) => tagChatLoadStep('start', error));
    if (options.signal?.aborted) throw new Error('E2E interrupted');
    const result = await options
      .exercise(options.signal)
      .catch((error) => tagChatLoadStep('exercise', error));
    if (options.captureChatLoad === true)
      try {
        return collectChatLoadEvidence(result);
      } catch (error) {
        tagChatLoadStep('validation', error);
      }
    return result;
  } catch (error) {
    keep = false;
    throw error;
  } finally {
    if (!keep)
      try {
        await options
          .down(options.project)
          .catch((error) => tagChatLoadStep('teardown', error));
      } finally {
        await options
          .remove(options.directory)
          .catch((error) => tagChatLoadStep('teardown', error));
      }
  }
}
