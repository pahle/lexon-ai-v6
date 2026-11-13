const tracePrefix = 'AI_SMOKE_MOCK_TRACE ';
let requestCount = 0;

globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url);
  let body;
  try {
    body = await request.clone().json();
  } catch {
    body = {};
  }
  const provider = body.provider ?? {};
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const systemMessage = messages.find((message) => message?.role === 'system');
  const systemContent = systemMessage?.content;
  const hasSystemInstruction =
    (typeof systemContent === 'string' && systemContent.length > 0) ||
    (Array.isArray(systemContent) &&
      systemContent.some(
        (part) => part?.type === 'text' && typeof part.text === 'string',
      ));
  const trace = {
    requestCount: ++requestCount,
    effort: body.reasoning?.effort ?? 'unavailable',
    maxOutputTokens: body.max_tokens ?? 'unavailable',
    openRouterChatCompletions:
      url.hostname === 'openrouter.ai' &&
      url.pathname.endsWith('/chat/completions'),
    azureOnly:
      Array.isArray(provider.only) &&
      provider.only.length === 1 &&
      provider.only[0] === 'azure/us',
    noFallbacks: provider.allow_fallbacks === false,
    zdrOnly: provider.zdr === true,
    denyDataCollection: provider.data_collection === 'deny',
    hasSystemInstruction,
  };
  process.stderr.write(`${tracePrefix}${JSON.stringify(trace)}\n`);

  if (!trace.openRouterChatCompletions || !trace.azureOnly)
    return new Response('Synthetic fetch route rejected', { status: 599 });

  const model = typeof body.model === 'string' ? body.model : 'mock/model';
  return new Response(
    [
      `data: ${JSON.stringify({
        id: 'private-cli-generation-id',
        model,
        choices: [
          {
            index: 0,
            delta: { content: 'PRIVATE_CLI_ANSWER_CANARY' },
            finish_reason: null,
          },
        ],
      })}\n\n`,
      `data: ${JSON.stringify({
        id: 'private-cli-generation-id',
        model,
        provider: 'Azure',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 2,
          total_tokens: 12,
          cost: 0.00004,
        },
      })}\n\n`,
      'data: [DONE]\n\n',
    ].join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
};
