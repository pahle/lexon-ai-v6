import {
  MAX_PROVIDER_SSE_FRAME_BYTES,
  isProviderSseFrameTooLarge,
  type ProviderSseObserver,
} from './provider-sse-observer.js';

export function createReasoningFilteredFetch(
  fetch: typeof globalThis.fetch,
  observer: ProviderSseObserver,
  onTransportError?: (error: unknown) => void,
): typeof globalThis.fetch {
  return async (input, init) => {
    let response: Response;
    try {
      response = await fetch(input, init);
    } catch (error) {
      onTransportError?.(error);
      throw sanitizeTransportFailure(error);
    }
    if (!response.ok)
      return new Response('{"error":{"message":"Provider request failed"}}', {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      });
    if (
      !response.body ||
      !response.headers.get('content-type')?.includes('text/event-stream')
    )
      return new Response(
        '{"error":{"message":"Provider response was invalid"}}',
        {
          status: 502,
          headers: { 'content-type': 'application/json' },
        },
      );

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let line = '';
    let dataLines: string[] = [];
    let frameBytes = 0;
    const processLine = async (
      rawLine: string,
      controller: TransformStreamDefaultController<Uint8Array>,
    ) => {
      const nextLine = rawLine.replace(/\r$/, '');
      frameBytes += encoder.encode(`${nextLine}\n`).byteLength;
      if (isProviderSseFrameTooLarge(frameBytes))
        throw new Error('Provider stream frame exceeded its safe limit');
      if (nextLine === '') {
        const data = dataLines.join('\n');
        if (!dataLines.length) controller.enqueue(encoder.encode('\n'));
        else if (data === '[DONE]')
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        else {
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            throw new Error('Provider stream frame was malformed');
          }
          const safe = await observer.observe(parsed);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(safe)}\n\n`),
          );
        }
        dataLines = [];
        frameBytes = 0;
      } else if (nextLine.startsWith('data:')) {
        dataLines.push(nextLine.slice(5).replace(/^ /, ''));
      }
    };
    const transform = new TransformStream<Uint8Array, Uint8Array>({
      async transform(chunk, controller) {
        const decoded = decoder.decode(chunk, { stream: true });
        let start = 0;
        let newline: number;
        while ((newline = decoded.indexOf('\n', start)) >= 0) {
          const nextLine = line + decoded.slice(start, newline);
          if (
            encoder.encode(nextLine).byteLength + frameBytes >
            MAX_PROVIDER_SSE_FRAME_BYTES
          )
            throw new Error('Provider stream frame exceeded its safe limit');
          await processLine(nextLine, controller);
          line = '';
          start = newline + 1;
        }
        line += decoded.slice(start);
        if (
          encoder.encode(line).byteLength + frameBytes >
          MAX_PROVIDER_SSE_FRAME_BYTES
        )
          throw new Error('Provider stream frame exceeded its safe limit');
      },
      async flush(controller) {
        line += decoder.decode();
        if (line) await processLine(line, controller);
        if (frameBytes) await processLine('', controller);
        if (dataLines.length) {
          const data = dataLines.join('\n');
          if (data !== '[DONE]') {
            let parsed: unknown;
            try {
              parsed = JSON.parse(data);
            } catch {
              throw new Error('Provider stream frame was malformed');
            }
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify(await observer.observe(parsed))}\n\n`,
              ),
            );
          }
        }
        await observer.finish();
      },
    });
    return new Response(
      sanitizeBodyErrors(response.body, onTransportError).pipeThrough(
        transform,
      ),
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      },
    );
  };
}

function sanitizeBodyErrors(
  body: ReadableStream<Uint8Array>,
  onTransportError?: (error: unknown) => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (error) {
        onTransportError?.(error);
        controller.error(sanitizeTransportFailure(error));
      }
    },
    async cancel() {
      await reader.cancel().catch(() => undefined);
    },
  });
}

function sanitizeTransportFailure(error: unknown): Error {
  const retryCodes = new Set([
    'ConnectionRefused',
    'ConnectionClosed',
    'FailedToOpenSocket',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
    'UND_ERR_SOCKET',
    'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT',
    'UND_ERR_CONNECT_TIMEOUT',
  ]);
  const visited = new Set<object>();
  let current: unknown = error;
  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    const code = (current as Error & { readonly code?: unknown }).code;
    if (typeof code === 'string' && retryCodes.has(code)) {
      const safeCause = Object.assign(
        new Error('Provider stream interrupted'),
        { code },
      );
      return new TypeError('fetch failed', { cause: safeCause });
    }
    current = current.cause;
  }
  return new Error('Provider stream interrupted');
}
