import { z } from 'zod';
import * as contracts from '@lexon/contracts';
import type { ChatApi, ChatGetResult } from '@lexon/contracts';
import { chatClientError, ChatClientError } from './chat-errors';
import { notifyIdentityFallbackHint } from './identity-client';
import { parseJsonResponse, requestJson } from './request-json';

export interface ChatClientOptions {
  readonly baseUrl: string;
  readonly fetch?: typeof fetch;
}

export function createChatClient(options: ChatClientOptions): ChatApi {
  if (
    !options.baseUrl.startsWith('/') ||
    options.baseUrl.startsWith('//') ||
    /[\\?#]/.test(options.baseUrl)
  )
    throw new Error('Chat API must use the same origin');

  const base = options.baseUrl.replace(/\/$/, '');
  const id = (value: string) => contracts.UuidSchema.parse(value);

  async function call<T>(
    path: string,
    schema: z.ZodType<T> | null,
    method = 'GET',
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await requestJson(
      base + path,
      { fetch: options.fetch, method, body, signal },
      () => new ChatClientError('AI_PROVIDER_UNAVAILABLE', 503),
    );
    if (notifyIdentityFallbackHint(response))
      throw new ChatClientError('AI_ACCESS_REVOKED', response.status);
    if (!response.ok) throw await chatClientError(response);
    return parseJsonResponse(
      response,
      schema,
      () => new ChatClientError('AI_INTERNAL', 503),
    );
  }

  const withPage = (
    path: string,
    input: {
      cursor?: string;
      limit?: number;
      scope?: contracts.ChatListScope;
    } = {},
  ) => {
    const query = new URLSearchParams();
    if (input.limit !== undefined) query.set('limit', String(input.limit));
    if (input.cursor) query.set('cursor', input.cursor);
    if (input.scope !== undefined) query.set('scope', input.scope);
    return path + (query.size > 0 ? `?${query.toString()}` : '');
  };

  async function getChat(
    chatId: string,
    request: { signal?: AbortSignal; ifNoneMatch?: string } = {},
  ): Promise<ChatGetResult> {
    const response = await requestJson(
      `${base}/chats/${id(chatId)}`,
      {
        fetch: options.fetch,
        method: 'GET',
        signal: request.signal,
        ...(request.ifNoneMatch === undefined
          ? {}
          : { headers: { 'if-none-match': request.ifNoneMatch } }),
      },
      () => new ChatClientError('AI_PROVIDER_UNAVAILABLE', 503),
    );
    if (notifyIdentityFallbackHint(response))
      throw new ChatClientError('AI_ACCESS_REVOKED', response.status);
    if (response.status === 304)
      return {
        notModified: true,
        etag: response.headers.get('etag') ?? '',
      };
    if (!response.ok) throw await chatClientError(response);
    return {
      notModified: false,
      tree: await parseJsonResponse(
        response,
        contracts.ChatDetailSchema,
        () => new ChatClientError('AI_INTERNAL', 503),
      ),
      etag: response.headers.get('etag'),
    };
  }

  return {
    create: (input) =>
      call(
        '/chats',
        contracts.ChatMutationResultSchema,
        'POST',
        contracts.CreateChatInputSchema.parse(input),
      ),
    get: getChat,
    list: (input, signal) =>
      call(
        withPage('/chats', input),
        contracts.ChatPageSchema,
        'GET',
        undefined,
        signal,
      ),
    search: (input, signal) =>
      call(
        '/chats/search',
        contracts.ChatSearchPageSchema,
        'POST',
        contracts.ChatSearchRequestSchema.parse(input),
        signal,
      ),
    resolveSearchMatch: (chatId, messageId) =>
      call(
        `/chats/${id(chatId)}/search-match/${id(messageId)}`,
        contracts.ChatSearchMatchSchema,
        'POST',
      ),
    setFeedback: (chatId, messageId, input) =>
      call(
        `/chats/${id(chatId)}/messages/${id(messageId)}/feedback`,
        null,
        'PUT',
        contracts.SetChatFeedbackInputSchema.parse(input),
      ),
    send: (chatId, input) =>
      call(
        `/chats/${id(chatId)}/messages`,
        contracts.ChatMutationResultSchema,
        'POST',
        contracts.SendMessageInputSchema.parse(input),
      ),
    edit: (chatId, input) =>
      call(
        `/chats/${id(chatId)}/messages/${id(input.messageId)}/edit`,
        contracts.ChatMutationResultSchema,
        'POST',
        contracts.EditMessageInputSchema.parse(input),
      ),
    regenerate: (chatId, input) =>
      call(
        `/chats/${id(chatId)}/messages/${id(input.messageId)}/regenerate`,
        contracts.ChatMutationResultSchema,
        'POST',
        contracts.RegenerateInputSchema.parse(input),
      ),
    setViewedLeaf: (chatId, input) =>
      call(
        `/chats/${id(chatId)}/viewed-leaf`,
        null,
        'PUT',
        contracts.ViewedLeafInputSchema.parse(input),
      ),
    rename: (chatId, input) =>
      call(
        `/chats/${id(chatId)}`,
        null,
        'PATCH',
        contracts.RenameChatInputSchema.parse(input),
      ),
    delete: (chatId) => call(`/chats/${id(chatId)}`, null, 'DELETE'),
    decideOperation: (runId, operationId, input) =>
      call(
        `/runs/${id(runId)}/operations/${id(operationId)}/decision`,
        contracts.OperationDecisionResultSchema,
        'POST',
        contracts.OperationDecisionInputSchema.parse(input),
      ),
  };
}
