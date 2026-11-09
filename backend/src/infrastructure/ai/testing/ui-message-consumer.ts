import { readUIMessageStream, type UIMessage, type UIMessageChunk } from 'ai';

export type { UIMessage, UIMessageChunk } from 'ai';

/** Test-only replay of persisted Lexon stream events through the pinned AI SDK consumer. */
export async function consumeUiMessageChunks(
  chunks: readonly UIMessageChunk[],
  initialMessage?: UIMessage,
): Promise<unknown[]> {
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });

  const messages: unknown[] = [];
  for await (const message of readUIMessageStream({
    ...(initialMessage ? { message: initialMessage } : {}),
    stream,
    terminateOnError: true,
  }))
    messages.push(message);
  return messages;
}
